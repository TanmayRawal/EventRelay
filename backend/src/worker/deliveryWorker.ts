import axios from 'axios';
import { query } from '../db/client';
import { streamQueue, DeliveryJob } from '../redis/streamQueue';
import { circuitBreaker } from '../resilience/circuitBreaker';
import { calculateFullJitterDelay } from '../resilience/backoff';
import { rateLimiter } from '../resilience/tokenBucket';
import { hmacSigner } from '../crypto/hmacSigner';
import { config } from '../config';
import { metrics } from '../metrics/prometheus';
import { ShardLeaseCoordinator } from './shardLeaseCoordinator';
import { partitioner } from '../sharding/partitioner';
import { syncEventStatus } from '../db/eventStatus';
import { validateEndpointUrl, createSecureAgents } from '../security/ssrfValidator';

export class DeliveryWorker {
  private isRunning: boolean = false;
  private workerId: string;
  private leaseCoordinator: ShardLeaseCoordinator;
  private secureAgents = createSecureAgents();

  constructor(workerId: string = config.consumerName) {
    this.workerId = workerId;
    this.leaseCoordinator = new ShardLeaseCoordinator(workerId);
  }

  getCoordinator(): ShardLeaseCoordinator {
    return this.leaseCoordinator;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[DeliveryWorker] Started worker '${this.workerId}'. Initializing shard partition leases...`);

    await this.leaseCoordinator.start();

    while (this.isRunning) {
      try {
        const ownedShards = this.leaseCoordinator.getOwnedShards();

        if (ownedShards.length === 0) {
          // No shard leases acquired yet, wait briefly for coordinator heartbeat
          await new Promise((res) => setTimeout(res, 300));
          continue;
        }

        let hadMessages = false;
        const shardStreams = partitioner.getAllShardStreams(config.streamName);

        for (const shardId of ownedShards) {
          if (!this.isRunning) break;

          const targetStream = shardStreams[shardId] || config.streamName;

          // 1. Recover any unacknowledged messages from dead workers using XAUTOCLAIM
          const claimedMessages = await streamQueue.autoClaimPending(targetStream, this.workerId, 30000, 5);
          for (const { messageId, streamName, job } of claimedMessages) {
            hadMessages = true;
            await this.processJob(messageId, streamName, job);
          }

          // 2. Read new messages exclusively for this owned shard (preserving in-order FIFO execution)
          const messages = await streamQueue.readShardMessages(targetStream, this.workerId, 5, 20);
          for (const { messageId, streamName, job } of messages) {
            hadMessages = true;
            await this.processJob(messageId, streamName, job);
          }
        }

        // 3. Also read unpartitioned deliveries from baseStream
        const claimedBase = await streamQueue.autoClaimPending(config.streamName, this.workerId, 30000, 5);
        for (const { messageId, streamName, job } of claimedBase) {
          hadMessages = true;
          await this.processJob(messageId, streamName, job);
        }

        const baseMessages = await streamQueue.readShardMessages(config.streamName, this.workerId, 10, 50);
        for (const { messageId, streamName, job } of baseMessages) {
          hadMessages = true;
          await this.processJob(messageId, streamName, job);
        }

        if (!hadMessages) {
          await new Promise((res) => setTimeout(res, 50));
        }
      } catch (err: any) {
        console.error(`[DeliveryWorker] Loop error:`, err.message);
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log(`[DeliveryWorker] Stopping worker '${this.workerId}'...`);
    await this.leaseCoordinator.releaseAll();
  }

  async processJob(messageId: string, streamName: string, job: DeliveryJob): Promise<void> {
    const { deliveryId, eventId, endpointId, attemptNumber } = job;

    // 1. Fetch Event & Endpoint details
    const eventRes = await query(`SELECT * FROM events WHERE id = $1`, [eventId]);
    const endpointRes = await query(`SELECT * FROM endpoints WHERE id = $1`, [endpointId]);

    if (eventRes.rows.length === 0 || endpointRes.rows.length === 0) {
      console.warn(`[DeliveryWorker] Missing event (${eventId}) or endpoint (${endpointId}). Skipping.`);
      await streamQueue.acknowledge(streamName, messageId);
      return;
    }

    const event = eventRes.rows[0];
    const endpoint = endpointRes.rows[0];

    // 2. Check Rate Limiter with in-place wait to preserve partition FIFO sequence
    let allowed = await rateLimiter.consume(
      `endpoint:${endpoint.id}`,
      endpoint.rate_limit_rps,
      endpoint.rate_limit_rps
    );

    if (!allowed) {
      console.warn(`[DeliveryWorker] Rate limit reached for ${endpoint.name}. In-place backoff (500ms)...`);
      await new Promise((res) => setTimeout(res, 500));
      allowed = await rateLimiter.consume(
        `endpoint:${endpoint.id}`,
        endpoint.rate_limit_rps,
        endpoint.rate_limit_rps
      );

      if (!allowed) {
        // Schedule next retry rather than reordering stream at tail
        await this.handleFailure(
          deliveryId,
          eventId,
          endpoint,
          attemptNumber,
          429,
          'Endpoint rate limit throttled. Scheduled for backoff retry.'
        );
        await streamQueue.acknowledge(streamName, messageId);
        return;
      }
    }

    // 3. Check Circuit Breaker
    const canCall = await circuitBreaker.canExecute(endpoint.id);
    if (!canCall) {
      console.warn(`[DeliveryWorker] Circuit OPEN for ${endpoint.name}. Fast-failing delivery.`);
      await this.handleFailure(
        deliveryId,
        eventId,
        endpoint,
        attemptNumber,
        null,
        'Circuit breaker is OPEN. Target host in cool-down.'
      );
      await streamQueue.acknowledge(streamName, messageId);
      return;
    }

    // 4. SSRF Defense: Re-validate endpoint URL at dispatch time (prevents DNS rebinding and redirect attacks)
    const ssrfCheck = await validateEndpointUrl(endpoint.url);
    if (!ssrfCheck.valid) {
      console.error(`[DeliveryWorker] SSRF violation on delivery ${deliveryId}: ${ssrfCheck.error}`);
      await this.handleFailure(
        deliveryId,
        eventId,
        endpoint,
        attemptNumber,
        400,
        `SSRF Protection: ${ssrfCheck.error}`
      );
      await streamQueue.acknowledge(streamName, messageId);
      return;
    }

    // 5. Sign Payload with HMAC-SHA256
    const rawPayload = JSON.stringify(event.payload);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'EventRelay-Engine/1.0',
      'X-EventRelay-Event-ID': event.id,
      'X-EventRelay-Event-Type': event.event_type,
      'X-EventRelay-Delivery-ID': deliveryId,
      ...hmacSigner.sign(rawPayload, endpoint.secret_key)
    };

    // 6. Execute HTTP Dispatch
    const startTime = Date.now();
    try {
      const response = await axios.post(endpoint.url, event.payload, {
        headers,
        timeout: endpoint.timeout_ms,
        maxRedirects: 0, // Webhooks must not follow redirects to protect against redirect SSRF
        httpAgent: this.secureAgents.httpAgent,
        httpsAgent: this.secureAgents.httpsAgent
      });

      const durationMs = Date.now() - startTime;

      // 6. Record Success
      await query(
        `UPDATE deliveries
         SET http_status = $1, response_body = $2, duration_ms = $3,
             status = 'SUCCESS', error_message = NULL, next_retry_at = NULL
         WHERE id = $4`,
        [response.status, JSON.stringify(response.data).slice(0, 2048), durationMs, deliveryId]
      );

      // Synchronize overall event status across all fan-out child deliveries
      await syncEventStatus(eventId);

      await circuitBreaker.recordSuccess(endpoint.id);
      metrics.incDelivery(endpoint.name, 'SUCCESS');
      metrics.observeLatency(durationMs / 1000.0);
      console.log(`[DeliveryWorker] Delivery ${deliveryId} -> SUCCESS (${response.status}) in ${durationMs}ms`);

    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const httpStatus = err.response ? err.response.status : null;
      const errorMsg = err.response
        ? `HTTP ${httpStatus}: ${JSON.stringify(err.response.data).slice(0, 500)}`
        : err.message;

      console.error(`[DeliveryWorker] Delivery ${deliveryId} -> FAILED: ${errorMsg}`);
      metrics.incDelivery(endpoint.name, 'FAILED');
      metrics.observeLatency(durationMs / 1000.0);
      await circuitBreaker.recordFailure(endpoint.id);

      await this.handleFailure(
        deliveryId,
        eventId,
        endpoint,
        attemptNumber,
        httpStatus,
        errorMsg,
        durationMs
      );
    } finally {
      await streamQueue.acknowledge(streamName, messageId);
    }
  }

  private async handleFailure(
    deliveryId: string,
    eventId: string,
    endpoint: any,
    attemptNumber: number,
    httpStatus: number | null,
    errorMsg: string,
    durationMs: number = 0
  ): Promise<void> {
    const maxRetries = endpoint.max_retries || config.maxRetriesDefault;

    if (attemptNumber < maxRetries) {
      // Schedule next retry with Full Jitter Backoff
      const delaySeconds = calculateFullJitterDelay(attemptNumber);
      const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);

      await query(
        `UPDATE deliveries
         SET http_status = $1, error_message = $2, duration_ms = $3,
             status = 'RETRYING', next_retry_at = $4, attempt_number = $5
         WHERE id = $6`,
        [httpStatus, errorMsg, durationMs, nextRetryAt, attemptNumber, deliveryId]
      );

      await syncEventStatus(eventId);
      console.log(`[DeliveryWorker] Scheduled attempt #${attemptNumber + 1} in ${delaySeconds}s for delivery ${deliveryId}`);
    } else {
      // Exceeded max retries: Dead-Letter Queue
      await query(
        `UPDATE deliveries
         SET http_status = $1, error_message = $2, duration_ms = $3,
             status = 'DEAD_LETTER', next_retry_at = NULL
         WHERE id = $4`,
        [httpStatus, errorMsg, durationMs, deliveryId]
      );

      await syncEventStatus(eventId);
      metrics.incDlq();
      console.warn(`[DeliveryWorker] Delivery ${deliveryId} transitioned to DEAD_LETTER (Max attempts exceeded)`);
    }
  }
}

export const deliveryWorker = new DeliveryWorker();

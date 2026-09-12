"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryWorker = exports.DeliveryWorker = void 0;
const axios_1 = __importDefault(require("axios"));
const client_1 = require("../db/client");
const streamQueue_1 = require("../redis/streamQueue");
const circuitBreaker_1 = require("../resilience/circuitBreaker");
const backoff_1 = require("../resilience/backoff");
const tokenBucket_1 = require("../resilience/tokenBucket");
const hmacSigner_1 = require("../crypto/hmacSigner");
const config_1 = require("../config");
class DeliveryWorker {
    isRunning = false;
    workerId;
    constructor(workerId = config_1.config.consumerName) {
        this.workerId = workerId;
    }
    async start() {
        this.isRunning = true;
        console.log(`[DeliveryWorker] Started worker '${this.workerId}'. Listening to Redis stream...`);
        while (this.isRunning) {
            try {
                const messages = await streamQueue_1.streamQueue.readMessages(this.workerId, 5, 2000);
                for (const { messageId, job } of messages) {
                    await this.processJob(messageId, job);
                }
            }
            catch (err) {
                console.error(`[DeliveryWorker] Loop error:`, err.message);
                await new Promise((res) => setTimeout(res, 1000));
            }
        }
    }
    stop() {
        this.isRunning = false;
        console.log(`[DeliveryWorker] Stopping worker '${this.workerId}'...`);
    }
    async processJob(messageId, job) {
        const { deliveryId, eventId, endpointId, attemptNumber } = job;
        // 1. Fetch Event & Endpoint details
        const eventRes = await (0, client_1.query)(`SELECT * FROM events WHERE id = $1`, [eventId]);
        const endpointRes = await (0, client_1.query)(`SELECT * FROM endpoints WHERE id = $1`, [endpointId]);
        if (eventRes.rows.length === 0 || endpointRes.rows.length === 0) {
            console.warn(`[DeliveryWorker] Missing event (${eventId}) or endpoint (${endpointId}). Skipping.`);
            await streamQueue_1.streamQueue.acknowledge(messageId);
            return;
        }
        const event = eventRes.rows[0];
        const endpoint = endpointRes.rows[0];
        // 2. Check Rate Limiter
        const allowed = await tokenBucket_1.rateLimiter.consume(`endpoint:${endpoint.id}`, endpoint.rate_limit_rps, endpoint.rate_limit_rps);
        if (!allowed) {
            console.warn(`[DeliveryWorker] Rate limit exceeded for endpoint ${endpoint.name}. Delaying...`);
            await new Promise((res) => setTimeout(res, 500));
            // Re-publish to stream for later processing
            await streamQueue_1.streamQueue.publish(job);
            await streamQueue_1.streamQueue.acknowledge(messageId);
            return;
        }
        // 3. Check Circuit Breaker
        const canCall = await circuitBreaker_1.circuitBreaker.canExecute(endpoint.id);
        if (!canCall) {
            console.warn(`[DeliveryWorker] Circuit OPEN for ${endpoint.name}. Fast-failing delivery.`);
            await this.handleFailure(deliveryId, eventId, endpoint, attemptNumber, null, 'Circuit breaker is OPEN. Target host in cool-down.');
            await streamQueue_1.streamQueue.acknowledge(messageId);
            return;
        }
        // 4. Sign Payload with HMAC-SHA256
        const rawPayload = JSON.stringify(event.payload);
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'EventRelay-Engine/1.0',
            'X-EventRelay-Event-ID': event.id,
            'X-EventRelay-Event-Type': event.event_type,
            'X-EventRelay-Delivery-ID': deliveryId,
            ...hmacSigner_1.hmacSigner.sign(rawPayload, endpoint.secret_key)
        };
        // 5. Execute HTTP Dispatch
        const startTime = Date.now();
        try {
            const response = await axios_1.default.post(endpoint.url, event.payload, {
                headers,
                timeout: endpoint.timeout_ms
            });
            const durationMs = Date.now() - startTime;
            // 6. Record Success
            await (0, client_1.query)(`UPDATE deliveries
         SET http_status = $1, response_body = $2, duration_ms = $3,
             status = 'SUCCESS', error_message = NULL
         WHERE id = $4`, [response.status, JSON.stringify(response.data).slice(0, 2048), durationMs, deliveryId]);
            await (0, client_1.query)(`UPDATE events SET status = 'COMPLETED' WHERE id = $1`, [eventId]);
            await circuitBreaker_1.circuitBreaker.recordSuccess(endpoint.id);
            console.log(`[DeliveryWorker] Delivery ${deliveryId} -> SUCCESS (${response.status}) in ${durationMs}ms`);
        }
        catch (err) {
            const durationMs = Date.now() - startTime;
            const httpStatus = err.response ? err.response.status : null;
            const errorMsg = err.response
                ? `HTTP ${httpStatus}: ${JSON.stringify(err.response.data).slice(0, 500)}`
                : err.message;
            console.error(`[DeliveryWorker] Delivery ${deliveryId} -> FAILED: ${errorMsg}`);
            await circuitBreaker_1.circuitBreaker.recordFailure(endpoint.id);
            await this.handleFailure(deliveryId, eventId, endpoint, attemptNumber, httpStatus, errorMsg, durationMs);
        }
        finally {
            await streamQueue_1.streamQueue.acknowledge(messageId);
        }
    }
    async handleFailure(deliveryId, eventId, endpoint, attemptNumber, httpStatus, errorMsg, durationMs = 0) {
        const maxRetries = endpoint.max_retries || config_1.config.maxRetriesDefault;
        if (attemptNumber < maxRetries) {
            // Schedule next retry with Full Jitter Backoff
            const delaySeconds = (0, backoff_1.calculateFullJitterDelay)(attemptNumber);
            const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
            await (0, client_1.query)(`UPDATE deliveries
         SET http_status = $1, error_message = $2, duration_ms = $3,
             status = 'RETRYING', next_retry_at = $4, attempt_number = $5
         WHERE id = $6`, [httpStatus, errorMsg, durationMs, nextRetryAt, attemptNumber, deliveryId]);
            // In production, a scheduler/cron re-enqueues retrying deliveries when next_retry_at is reached
            console.log(`[DeliveryWorker] Scheduled attempt #${attemptNumber + 1} in ${delaySeconds}s for delivery ${deliveryId}`);
        }
        else {
            // Exceeded max retries: Dead-Letter Queue
            await (0, client_1.query)(`UPDATE deliveries
         SET http_status = $1, error_message = $2, duration_ms = $3,
             status = 'DEAD_LETTER', next_retry_at = NULL
         WHERE id = $4`, [httpStatus, errorMsg, durationMs, deliveryId]);
            await (0, client_1.query)(`UPDATE events SET status = 'FAILED' WHERE id = $1`, [eventId]);
            console.warn(`[DeliveryWorker] Delivery ${deliveryId} transitioned to DEAD_LETTER (Max attempts exceeded)`);
        }
    }
}
exports.DeliveryWorker = DeliveryWorker;
exports.deliveryWorker = new DeliveryWorker();

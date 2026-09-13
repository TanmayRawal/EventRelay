import { withTransaction } from '../db/client';
import { outboxPublisher } from './outboxPublisher';
import { syncEventStatus } from '../db/eventStatus';
import { metrics } from '../metrics/prometheus';

export class RetryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isPolling: boolean = false;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 3000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[RetryScheduler] Polling due retries every ${this.pollIntervalMs}ms...`);

    this.timer = setInterval(async () => {
      await this.pollAndReenqueue();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[RetryScheduler] Stopped.');
  }

  /**
   * Concurrency-safe poll using PostgreSQL FOR UPDATE SKIP LOCKED.
   * Atomically claims due retry records without contention or duplicate scheduling
   * across multiple scheduler instances.
   */
  async pollAndReenqueue(): Promise<number> {
    if (this.isPolling) return 0;
    this.isPolling = true;

    try {
      const processedCount = await withTransaction(async (client) => {
        const res = await client.query(
          `SELECT d.id, d.event_id, d.endpoint_id, d.attempt_number,
                  e.ordering_key, ep.max_retries
           FROM deliveries d
           JOIN events e ON d.event_id = e.id
           JOIN endpoints ep ON d.endpoint_id = ep.id
           WHERE d.status = 'RETRYING'
             AND d.next_retry_at IS NOT NULL
             AND d.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY d.next_retry_at ASC
           LIMIT 50
           FOR UPDATE SKIP LOCKED`
        );

        if (res.rows.length === 0) return 0;

        for (const row of res.rows) {
          const nextAttempt = row.attempt_number + 1;

          if (nextAttempt > (row.max_retries || 5)) {
            // Exceeded max retries: move to DEAD_LETTER
            await client.query(
              `UPDATE deliveries
               SET status = 'DEAD_LETTER', next_retry_at = NULL,
                   error_message = 'Max retry attempts exceeded. Moved to DLQ by scheduler.'
               WHERE id = $1`,
              [row.id]
            );
            await syncEventStatus(row.event_id, client);
            metrics.incDlq();
            console.warn(`[RetryScheduler] Delivery ${row.id} exceeded max retries -> DEAD_LETTER`);
          } else {
            // Update delivery attempt and next_retry_at
            await client.query(
              `UPDATE deliveries
               SET attempt_number = $1, next_retry_at = NULL
               WHERE id = $2`,
              [nextAttempt, row.id]
            );

            // Write to Transactional Outbox inside the same transaction
            await client.query(
              `INSERT INTO outbox (delivery_id, event_id, endpoint_id, attempt_number, ordering_key)
               VALUES ($1, $2, $3, $4, $5)`,
              [row.id, row.event_id, row.endpoint_id, nextAttempt, row.ordering_key || null]
            );

            await syncEventStatus(row.event_id, client);
            console.log(`[RetryScheduler] Re-enqueued delivery ${row.id} for attempt #${nextAttempt}`);
          }
        }

        return res.rows.length;
      });

      if (processedCount > 0) {
        outboxPublisher.poke();
      }

      return processedCount;
    } catch (err: any) {
      console.error('[RetryScheduler] Poll error:', err.message);
      return 0;
    } finally {
      this.isPolling = false;
    }
  }
}

export const retryScheduler = new RetryScheduler(3000);

import { query } from '../db/client';
import { streamQueue } from '../redis/streamQueue';
import { metrics } from '../metrics/prometheus';

export class RetryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
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

  async pollAndReenqueue(): Promise<number> {
    try {
      // Find deliveries due for retry
      const res = await query(
        `SELECT d.id, d.event_id, d.endpoint_id, d.attempt_number,
                e.ordering_key, ep.max_retries
         FROM deliveries d
         JOIN events e ON d.event_id = e.id
         JOIN endpoints ep ON d.endpoint_id = ep.id
         WHERE d.status = 'RETRYING'
           AND d.next_retry_at IS NOT NULL
           AND d.next_retry_at <= CURRENT_TIMESTAMP
         ORDER BY d.next_retry_at ASC
         LIMIT 50`
      );

      if (res.rows.length === 0) return 0;

      for (const row of res.rows) {
        const nextAttempt = row.attempt_number + 1;

        if (nextAttempt > (row.max_retries || 5)) {
          // Exceeded max retries: move to DEAD_LETTER
          await query(
            `UPDATE deliveries
             SET status = 'DEAD_LETTER', next_retry_at = NULL,
                 error_message = 'Max retry attempts exceeded. Moved to DLQ by scheduler.'
             WHERE id = $1`,
            [row.id]
          );
          metrics.incDlq();
          console.warn(`[RetryScheduler] Delivery ${row.id} exceeded max retries -> DEAD_LETTER`);
        } else {
          // Re-enqueue into partitioned stream
          await query(
            `UPDATE deliveries
             SET attempt_number = $1, next_retry_at = NULL
             WHERE id = $2`,
            [nextAttempt, row.id]
          );

          await streamQueue.publish({
            deliveryId: row.id,
            eventId: row.event_id,
            endpointId: row.endpoint_id,
            attemptNumber: nextAttempt
          }, row.ordering_key);

          console.log(`[RetryScheduler] Re-enqueued delivery ${row.id} for attempt #${nextAttempt}`);
        }
      }

      return res.rows.length;
    } catch (err: any) {
      console.error('[RetryScheduler] Poll error:', err.message);
      return 0;
    }
  }
}

export const retryScheduler = new RetryScheduler(3000);

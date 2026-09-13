import { query, withTransaction } from '../db/client';
import { streamQueue } from '../redis/streamQueue';
import { metrics } from '../metrics/prometheus';

export interface OutboxRecord {
  id: string;
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  attempt_number: number;
  ordering_key: string | null;
}

export class OutboxPublisher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isDraining: boolean = false;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 200) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[OutboxPublisher] Started. Polling outbox every ${this.pollIntervalMs}ms...`);

    this.timer = setInterval(async () => {
      await this.drain();
    }, this.pollIntervalMs);

    // Initial drain pass immediately on start
    this.drain().catch((err) => {
      console.error('[OutboxPublisher] Initial drain error:', err.message);
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[OutboxPublisher] Stopped.');
  }

  /**
   * Pokes the publisher to trigger an immediate drain cycle (e.g. right after an ingest).
   */
  poke(): void {
    if (!this.isRunning) return;
    setImmediate(() => {
      this.drain().catch((err) => {
        console.error('[OutboxPublisher] Poke drain error:', err.message);
      });
    });
  }

  /**
   * Atomically claims and drains pending outbox rows using FOR UPDATE SKIP LOCKED,
   * publishes them to partitioned Redis Streams, and removes published rows.
   */
  async drain(): Promise<number> {
    if (this.isDraining) return 0;
    this.isDraining = true;

    try {
      return await withTransaction(async (client) => {
        const selectRes = await client.query<OutboxRecord>(
          `SELECT id, delivery_id, event_id, endpoint_id, attempt_number, ordering_key
           FROM outbox
           ORDER BY created_at ASC
           LIMIT 100
           FOR UPDATE SKIP LOCKED`
        );

        if (selectRes.rows.length === 0) {
          return 0;
        }

        const publishedIds: string[] = [];

        for (const row of selectRes.rows) {
          try {
            await streamQueue.publish({
              deliveryId: row.delivery_id,
              eventId: row.event_id,
              endpointId: row.endpoint_id,
              attemptNumber: row.attempt_number
            }, row.ordering_key);

            publishedIds.push(row.id);
          } catch (pubErr: any) {
            console.error(`[OutboxPublisher] Failed to publish outbox item ${row.id} to Redis:`, pubErr.message);
            // Stop publishing further items in this batch to preserve order
            break;
          }
        }

        if (publishedIds.length > 0) {
          await client.query(
            `DELETE FROM outbox WHERE id = ANY($1::uuid[])`,
            [publishedIds]
          );
        }

        return publishedIds.length;
      });
    } catch (err: any) {
      console.error('[OutboxPublisher] Drain error:', err.message);
      return 0;
    } finally {
      this.isDraining = false;
    }
  }
}

export const outboxPublisher = new OutboxPublisher(200);

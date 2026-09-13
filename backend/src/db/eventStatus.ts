import { PoolClient } from 'pg';
import { query } from './client';

export type EventAggregateStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL_SUCCESS';

/**
 * Synchronizes the aggregate status of an event based on the status of all its child deliveries.
 * - All SUCCESS -> COMPLETED
 * - All DEAD_LETTER -> FAILED
 * - Any RETRYING or PENDING -> PROCESSING
 * - Both SUCCESS and DEAD_LETTER (with no remaining RETRYING) -> PARTIAL_SUCCESS
 */
export async function syncEventStatus(eventId: string, client?: PoolClient): Promise<EventAggregateStatus | null> {
  const runner = client ? client.query.bind(client) : query;

  const res = await runner(
    `SELECT status, COUNT(*)::int as count
     FROM deliveries
     WHERE event_id = $1
     GROUP BY status`,
    [eventId]
  );

  if (res.rows.length === 0) {
    return null;
  }

  let successCount = 0;
  let deadLetterCount = 0;
  let retryingCount = 0;
  let total = 0;

  for (const row of res.rows) {
    const c = row.count;
    total += c;
    if (row.status === 'SUCCESS') successCount += c;
    else if (row.status === 'DEAD_LETTER') deadLetterCount += c;
    else if (row.status === 'RETRYING') retryingCount += c;
  }

  let aggregateStatus: EventAggregateStatus = 'PROCESSING';

  if (retryingCount > 0) {
    aggregateStatus = 'PROCESSING';
  } else if (successCount === total) {
    aggregateStatus = 'COMPLETED';
  } else if (deadLetterCount === total) {
    aggregateStatus = 'FAILED';
  } else if (successCount > 0 && deadLetterCount > 0) {
    aggregateStatus = 'PARTIAL_SUCCESS';
  }

  await runner(
    `UPDATE events SET status = $1 WHERE id = $2`,
    [aggregateStatus, eventId]
  );

  return aggregateStatus;
}

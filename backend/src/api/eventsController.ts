import { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/client';
import { outboxPublisher } from '../worker/outboxPublisher';
import { metrics } from '../metrics/prometheus';

const IngestEventSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.any()),
  endpointIds: z.array(z.string().uuid()).optional(),
  orderingKey: z.string().optional()
});

export async function ingestEvent(req: Request, res: Response) {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const parseResult = IngestEventSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { eventType, payload, endpointIds, orderingKey } = parseResult.data;

  try {
    // Ingest Event & Fan-Out Deliveries Atomically in a Single Transaction
    const result = await withTransaction(async (client) => {
      // 1. Atomic Idempotent Insert using ON CONFLICT
      const eventInsert = await client.query(
        `INSERT INTO events (idempotency_key, event_type, payload, status, ordering_key)
         VALUES ($1, $2, $3, 'PROCESSING', $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [idempotencyKey, eventType, JSON.stringify(payload), orderingKey || null]
      );

      // If row was not inserted, a concurrent or earlier request claimed this key
      if (eventInsert.rows.length === 0) {
        const existing = await client.query(`SELECT * FROM events WHERE idempotency_key = $1`, [idempotencyKey]);
        return { isDuplicate: true, event: existing.rows[0], deliveries: [] };
      }

      const newEvent = eventInsert.rows[0];
      metrics.incIngested(eventType);

      // 2. Query active target endpoints respecting subscription filter
      let targetEndpointsQuery = `
        SELECT id FROM endpoints
        WHERE is_active = true
          AND (subscribed_events = '{}' OR $1 = ANY(subscribed_events))
      `;
      const queryParams: any[] = [eventType];

      if (endpointIds && endpointIds.length > 0) {
        targetEndpointsQuery += ` AND id = ANY($2::uuid[])`;
        queryParams.push(endpointIds);
      }

      const endpoints = await client.query(targetEndpointsQuery, queryParams);

      if (endpoints.rows.length === 0) {
        await client.query(`UPDATE events SET status = 'NO_TARGETS' WHERE id = $1`, [newEvent.id]);
        newEvent.status = 'NO_TARGETS';
        return { isDuplicate: false, event: newEvent, deliveries: [] };
      }

      const createdDeliveries = [];

      // 3. Atomically write Delivery rows and Transactional Outbox entries
      for (const endpoint of endpoints.rows) {
        const deliveryInsert = await client.query(
          `INSERT INTO deliveries (event_id, endpoint_id, attempt_number, status)
           VALUES ($1, $2, 1, 'RETRYING')
           RETURNING *`,
          [newEvent.id, endpoint.id]
        );
        const delivery = deliveryInsert.rows[0];
        createdDeliveries.push(delivery);

        // Transactional Outbox write ensures delivery cannot be lost if process crashes before Redis
        await client.query(
          `INSERT INTO outbox (delivery_id, event_id, endpoint_id, attempt_number, ordering_key)
           VALUES ($1, $2, $3, 1, $4)`,
          [delivery.id, newEvent.id, endpoint.id, orderingKey || null]
        );
      }

      return { isDuplicate: false, event: newEvent, deliveries: createdDeliveries };
    });

    if (result.isDuplicate) {
      return res.status(200).json({
        success: true,
        message: 'Duplicate event detected (idempotent response)',
        eventId: result.event.id,
        event: result.event,
        duplicate: true
      });
    }

    // Poke outbox publisher to immediately drain and publish to Redis Streams
    outboxPublisher.poke();

    return res.status(201).json({
      success: true,
      message: 'Event successfully ingested and queued for delivery',
      eventId: result.event.id,
      deliveriesQueued: result.deliveries.length
    });

  } catch (err: any) {
    console.error('[IngestEvent] Error:', err);
    return res.status(500).json({ error: 'Internal server error during event ingestion' });
  }
}

export async function listEvents(req: Request, res: Response) {
  try {
    const limit = parseInt(req.query.limit as string || '20', 10);
    const result = await query(
      `SELECT * FROM events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

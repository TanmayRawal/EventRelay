import { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/client';
import { streamQueue } from '../redis/streamQueue';
import { metrics } from '../metrics/prometheus';

const IngestEventSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.any()),
  endpointIds: z.array(z.string().uuid()).optional()
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

  const { eventType, payload, endpointIds } = parseResult.data;

  try {
    // 1. Check Idempotency Cache
    const existing = await query(`SELECT * FROM events WHERE idempotency_key = $1`, [idempotencyKey]);
    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: 'Duplicate event detected (idempotent response)',
        event: existing.rows[0],
        duplicate: true
      });
    }

    // 2. Ingest Event & Fan-Out Deliveries in a Transaction
    const result = await withTransaction(async (client) => {
      const eventInsert = await client.query(
        `INSERT INTO events (idempotency_key, event_type, payload, status)
         VALUES ($1, $2, $3, 'PROCESSING')
         RETURNING *`,
        [idempotencyKey, eventType, JSON.stringify(payload)]
      );
      const newEvent = eventInsert.rows[0];
      metrics.incIngested(eventType);

      // Query active target endpoints
      let targetEndpointsQuery = `SELECT id FROM endpoints WHERE is_active = true`;
      let queryParams: any[] = [];

      if (endpointIds && endpointIds.length > 0) {
        targetEndpointsQuery += ` AND id = ANY($1::uuid[])`;
        queryParams = [endpointIds];
      }

      const endpoints = await client.query(targetEndpointsQuery, queryParams);
      const createdDeliveries = [];

      for (const endpoint of endpoints.rows) {
        const deliveryInsert = await client.query(
          `INSERT INTO deliveries (event_id, endpoint_id, attempt_number, status)
           VALUES ($1, $2, 1, 'RETRYING')
           RETURNING *`,
          [newEvent.id, endpoint.id]
        );
        createdDeliveries.push(deliveryInsert.rows[0]);
      }

      return { event: newEvent, deliveries: createdDeliveries };
    });

    // 3. Dispatch delivery jobs to Redis Streams
    for (const delivery of result.deliveries) {
      await streamQueue.publish({
        deliveryId: delivery.id,
        eventId: result.event.id,
        endpointId: delivery.endpoint_id,
        attemptNumber: 1
      });
    }

    return res.status(201).json({
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

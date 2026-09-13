import { Request, Response } from 'express';
import { query } from '../db/client';
import { streamQueue } from '../redis/streamQueue';

export async function listDeliveries(req: Request, res: Response) {
  try {
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string || '50', 10);

    let queryStr = `
      SELECT d.*, e.event_type, ep.name as endpoint_name, ep.url as endpoint_url
      FROM deliveries d
      JOIN events e ON d.event_id = e.id
      JOIN endpoints ep ON d.endpoint_id = ep.id
    `;
    const params: any[] = [];

    if (status) {
      queryStr += ` WHERE d.status = $1`;
      params.push(status);
    }

    queryStr += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(queryStr, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function replayDelivery(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const resDelivery = await query(
      `SELECT d.*, e.ordering_key
       FROM deliveries d
       JOIN events e ON d.event_id = e.id
       WHERE d.id = $1`,
      [id]
    );
    if (resDelivery.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery record not found' });
    }

    const delivery = resDelivery.rows[0];

    // Reset status to RETRYING and reset attempt number
    const updatedRes = await query(
      `UPDATE deliveries
       SET status = 'RETRYING', error_message = 'Manual replay triggered via admin console',
           attempt_number = 1, next_retry_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    // Re-queue to Redis Streams preserving entity shard ordering
    await streamQueue.publish({
      deliveryId: delivery.id,
      eventId: delivery.event_id,
      endpointId: delivery.endpoint_id,
      attemptNumber: 1
    }, delivery.ordering_key || undefined);

    console.log(`[Admin] Manual replay initiated for delivery: ${id}`);

    return res.json({
      message: 'Delivery successfully queued for manual replay',
      deliveryId: id,
      delivery: updatedRes.rows[0]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

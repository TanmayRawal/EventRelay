import { Request, Response } from 'express';
import { query, withTransaction } from '../db/client';
import { outboxPublisher } from '../worker/outboxPublisher';
import { syncEventStatus } from '../db/eventStatus';

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

    // Atomically reset status and write to outbox
    const updatedDelivery = await withTransaction(async (client) => {
      const updatedRes = await client.query(
        `UPDATE deliveries
         SET status = 'RETRYING', error_message = 'Manual replay triggered via admin console',
             attempt_number = 1, next_retry_at = NULL
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      await client.query(
        `INSERT INTO outbox (delivery_id, event_id, endpoint_id, attempt_number, ordering_key)
         VALUES ($1, $2, $3, 1, $4)`,
        [delivery.id, delivery.event_id, delivery.endpoint_id, delivery.ordering_key || null]
      );

      await syncEventStatus(delivery.event_id, client);
      return updatedRes.rows[0];
    });

    outboxPublisher.poke();
    console.log(`[Admin] Manual replay initiated for delivery: ${id}`);

    return res.json({
      message: 'Delivery successfully queued for manual replay',
      deliveryId: id,
      delivery: updatedDelivery
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

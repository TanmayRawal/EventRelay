"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDeliveries = listDeliveries;
exports.replayDelivery = replayDelivery;
const client_1 = require("../db/client");
const streamQueue_1 = require("../redis/streamQueue");
async function listDeliveries(req, res) {
    try {
        const status = req.query.status;
        const limit = parseInt(req.query.limit || '50', 10);
        let queryStr = `
      SELECT d.*, e.event_type, ep.name as endpoint_name, ep.url as endpoint_url
      FROM deliveries d
      JOIN events e ON d.event_id = e.id
      JOIN endpoints ep ON d.endpoint_id = ep.id
    `;
        const params = [];
        if (status) {
            queryStr += ` WHERE d.status = $1`;
            params.push(status);
        }
        queryStr += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await (0, client_1.query)(queryStr, params);
        return res.json(result.rows);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
async function replayDelivery(req, res) {
    const { id } = req.params;
    try {
        const resDelivery = await (0, client_1.query)(`SELECT * FROM deliveries WHERE id = $1`, [id]);
        if (resDelivery.rows.length === 0) {
            return res.status(404).json({ error: 'Delivery record not found' });
        }
        const delivery = resDelivery.rows[0];
        // Reset status to RETRYING and reset attempt number
        await (0, client_1.query)(`UPDATE deliveries
       SET status = 'RETRYING', error_message = 'Manual replay triggered via admin console',
           attempt_number = 1, next_retry_at = CURRENT_TIMESTAMP
       WHERE id = $1`, [id]);
        // Re-queue to Redis Streams
        await streamQueue_1.streamQueue.publish({
            deliveryId: delivery.id,
            eventId: delivery.event_id,
            endpointId: delivery.endpoint_id,
            attemptNumber: 1
        });
        console.log(`[Admin] Manual replay initiated for delivery: ${id}`);
        return res.json({
            message: 'Delivery successfully queued for manual replay',
            deliveryId: id
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

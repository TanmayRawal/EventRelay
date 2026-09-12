"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCircuits = listCircuits;
exports.resetCircuit = resetCircuit;
const client_1 = require("../db/client");
const circuitBreaker_1 = require("../resilience/circuitBreaker");
async function listCircuits(req, res) {
    try {
        const result = await (0, client_1.query)(`
      SELECT cb.*, ep.name as endpoint_name, ep.url as endpoint_url
      FROM circuit_breakers cb
      JOIN endpoints ep ON cb.endpoint_id = ep.id
      ORDER BY cb.state DESC, cb.updated_at DESC
    `);
        return res.json(result.rows);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
async function resetCircuit(req, res) {
    const { endpointId } = req.params;
    try {
        await circuitBreaker_1.circuitBreaker.resetCircuit(endpointId);
        return res.json({ message: `Circuit for endpoint ${endpointId} reset to CLOSED` });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEndpoint = createEndpoint;
exports.listEndpoints = listEndpoints;
const zod_1 = require("zod");
const client_1 = require("../db/client");
const crypto_1 = __importDefault(require("crypto"));
const CreateEndpointSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    url: zod_1.z.string().url(),
    rateLimitRps: zod_1.z.number().int().min(1).max(500).default(50),
    maxRetries: zod_1.z.number().int().min(1).max(10).default(5),
    timeoutMs: zod_1.z.number().int().min(500).max(30000).default(5000)
});
async function createEndpoint(req, res) {
    const parseResult = CreateEndpointSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.format() });
    }
    const { name, url, rateLimitRps, maxRetries, timeoutMs } = parseResult.data;
    const secretKey = `whsec_${crypto_1.default.randomBytes(24).toString('hex')}`;
    try {
        const insertRes = await (0, client_1.query)(`INSERT INTO endpoints (name, url, secret_key, rate_limit_rps, max_retries, timeout_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [name, url, secretKey, rateLimitRps, maxRetries, timeoutMs]);
        const newEndpoint = insertRes.rows[0];
        // Initialize Circuit Breaker record
        await (0, client_1.query)(`INSERT INTO circuit_breakers (endpoint_id, state) VALUES ($1, 'CLOSED') ON CONFLICT DO NOTHING`, [newEndpoint.id]);
        return res.status(201).json(newEndpoint);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
async function listEndpoints(req, res) {
    try {
        const result = await (0, client_1.query)(`
      SELECT e.*, cb.state as circuit_state, cb.failure_count as circuit_failures
      FROM endpoints e
      LEFT JOIN circuit_breakers cb ON e.id = cb.endpoint_id
      ORDER BY e.created_at DESC
    `);
        return res.json(result.rows);
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

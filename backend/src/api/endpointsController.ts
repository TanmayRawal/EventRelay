import { Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/client';
import crypto from 'crypto';

const CreateEndpointSchema = z.object({
  name: z.string().min(2),
  url: z.string().url(),
  rateLimitRps: z.number().int().min(1).max(500).default(50),
  maxRetries: z.number().int().min(1).max(10).default(5),
  timeoutMs: z.number().int().min(500).max(30000).default(5000)
});

export async function createEndpoint(req: Request, res: Response) {
  const parseResult = CreateEndpointSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { name, url, rateLimitRps, maxRetries, timeoutMs } = parseResult.data;
  const secretKey = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  try {
    const insertRes = await query(
      `INSERT INTO endpoints (name, url, secret_key, rate_limit_rps, max_retries, timeout_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, url, secretKey, rateLimitRps, maxRetries, timeoutMs]
    );

    const newEndpoint = insertRes.rows[0];

    // Initialize Circuit Breaker record
    await query(
      `INSERT INTO circuit_breakers (endpoint_id, state) VALUES ($1, 'CLOSED') ON CONFLICT DO NOTHING`,
      [newEndpoint.id]
    );

    return res.status(201).json(newEndpoint);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listEndpoints(req: Request, res: Response) {
  try {
    const result = await query(`
      SELECT e.id, e.name, e.url, e.rate_limit_rps, e.max_retries, e.timeout_ms, e.is_active, e.created_at,
             CONCAT(SUBSTRING(e.secret_key FROM 1 FOR 10), '****************') as secret_preview,
             cb.state as circuit_state, cb.failure_count as circuit_failures
      FROM endpoints e
      LEFT JOIN circuit_breakers cb ON e.id = cb.endpoint_id
      ORDER BY e.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

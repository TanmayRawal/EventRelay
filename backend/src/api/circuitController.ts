import { Request, Response } from 'express';
import { query } from '../db/client';
import { circuitBreaker } from '../resilience/circuitBreaker';

export async function listCircuits(req: Request, res: Response) {
  try {
    const result = await query(`
      SELECT cb.*, ep.name as endpoint_name, ep.url as endpoint_url
      FROM circuit_breakers cb
      JOIN endpoints ep ON cb.endpoint_id = ep.id
      ORDER BY cb.state DESC, cb.updated_at DESC
    `);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function resetCircuit(req: Request, res: Response) {
  const { endpointId } = req.params;
  try {
    await circuitBreaker.resetCircuit(endpointId);
    return res.json({ message: `Circuit for endpoint ${endpointId} reset to CLOSED` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

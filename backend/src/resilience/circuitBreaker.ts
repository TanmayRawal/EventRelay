import { query } from '../db/client';
import { metrics } from '../metrics/prometheus';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'HALF_OPEN_PROBING';

export interface CircuitRecord {
  endpointId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  thresholdFailures: number;
  coolDownSeconds: number;
  openedAt: Date | null;
  lastFailureAt: Date | null;
}

export class CircuitBreakerRegistry {
  async getCircuit(endpointId: string): Promise<CircuitRecord> {
    const res = await query(
      `SELECT endpoint_id as "endpointId", state, failure_count as "failureCount",
              success_count as "successCount", threshold_failures as "thresholdFailures",
              cool_down_seconds as "coolDownSeconds", opened_at as "openedAt",
              last_failure_at as "lastFailureAt"
       FROM circuit_breakers WHERE endpoint_id = $1`,
      [endpointId]
    );

    if (res.rows.length === 0) {
      // Initialize default circuit
      const initRes = await query(
        `INSERT INTO circuit_breakers (endpoint_id, state, failure_count, success_count)
         VALUES ($1, 'CLOSED', 0, 0)
         ON CONFLICT (endpoint_id) DO NOTHING
         RETURNING endpoint_id as "endpointId", state, failure_count as "failureCount",
                   success_count as "successCount", threshold_failures as "thresholdFailures",
                   cool_down_seconds as "coolDownSeconds", opened_at as "openedAt",
                   last_failure_at as "lastFailureAt"`,
        [endpointId]
      );
      if (initRes.rows.length > 0) return initRes.rows[0];
      return (await this.getCircuit(endpointId));
    }

    return res.rows[0];
  }

  /**
   * Evaluates if execution is permitted.
   * Single-probe safe: In HALF_OPEN, only one worker can atomically claim the trial probe lease.
   * Concurrent workers are fast-failed without network I/O until the probe completes.
   */
  async canExecute(endpointId: string): Promise<boolean> {
    const circuit = await this.getCircuit(endpointId);

    if (circuit.state === 'CLOSED') {
      return true;
    }

    if (circuit.state === 'OPEN') {
      const openedAt = circuit.openedAt ? new Date(circuit.openedAt).getTime() : 0;
      const now = Date.now();
      const coolDownMs = circuit.coolDownSeconds * 1000;

      if (now - openedAt > coolDownMs) {
        // Cooldown elapsed: attempt to atomically claim the single trial probe
        const claimRes = await query(
          `UPDATE circuit_breakers
           SET state = 'HALF_OPEN_PROBING', updated_at = CURRENT_TIMESTAMP
           WHERE endpoint_id = $1 AND state = 'OPEN'
           RETURNING state`,
          [endpointId]
        );

        if (claimRes.rows.length > 0) {
          metrics.setCircuitState(endpointId, 'HALF_OPEN');
          return true; // Single trial probe granted
        }
      }

      return false; // Still within cool-down or another worker claimed the probe
    }

    if (circuit.state === 'HALF_OPEN') {
      // Atomically claim the single probe lease
      const claimRes = await query(
        `UPDATE circuit_breakers
         SET state = 'HALF_OPEN_PROBING', updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1 AND state = 'HALF_OPEN'
         RETURNING state`,
        [endpointId]
      );
      return claimRes.rows.length > 0;
    }

    // HALF_OPEN_PROBING: a trial probe is already inflight. Fast-fail other concurrent dispatches.
    return false;
  }

  async recordSuccess(endpointId: string): Promise<void> {
    const circuit = await this.getCircuit(endpointId);

    if (circuit.state === 'HALF_OPEN' || circuit.state === 'HALF_OPEN_PROBING') {
      // Trial probe succeeded, reset circuit back to CLOSED
      await query(
        `UPDATE circuit_breakers
         SET state = 'CLOSED', failure_count = 0, success_count = 0, opened_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`,
        [endpointId]
      );
      metrics.setCircuitState(endpointId, 'CLOSED');
    } else if (circuit.state === 'CLOSED' && circuit.failureCount > 0) {
      await query(
        `UPDATE circuit_breakers
         SET failure_count = 0, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`,
        [endpointId]
      );
    }
  }

  async recordFailure(endpointId: string): Promise<CircuitState> {
    // Atomic failure count increment
    const updateRes = await query(
      `UPDATE circuit_breakers
       SET failure_count = failure_count + 1,
           last_failure_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE endpoint_id = $1
       RETURNING failure_count as "failureCount", threshold_failures as "thresholdFailures", state`,
      [endpointId]
    );

    if (updateRes.rows.length === 0) return 'OPEN';

    const row = updateRes.rows[0];

    if (row.state === 'HALF_OPEN_PROBING' || row.state === 'HALF_OPEN' || row.failureCount >= row.thresholdFailures) {
      // Trip circuit back to OPEN
      await query(
        `UPDATE circuit_breakers
         SET state = 'OPEN', opened_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`,
        [endpointId]
      );
      metrics.setCircuitState(endpointId, 'OPEN');
      return 'OPEN';
    }

    return row.state;
  }

  async resetCircuit(endpointId: string): Promise<void> {
    await query(
      `UPDATE circuit_breakers
       SET state = 'CLOSED', failure_count = 0, success_count = 0, opened_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE endpoint_id = $1`,
      [endpointId]
    );
    metrics.setCircuitState(endpointId, 'CLOSED');
  }
}

export const circuitBreaker = new CircuitBreakerRegistry();

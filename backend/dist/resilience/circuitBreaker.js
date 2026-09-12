"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuitBreaker = exports.CircuitBreakerRegistry = void 0;
const client_1 = require("../db/client");
class CircuitBreakerRegistry {
    localCache = new Map();
    async getCircuit(endpointId) {
        const res = await (0, client_1.query)(`SELECT endpoint_id as "endpointId", state, failure_count as "failureCount",
              success_count as "successCount", threshold_failures as "thresholdFailures",
              cool_down_seconds as "coolDownSeconds", opened_at as "openedAt",
              last_failure_at as "lastFailureAt"
       FROM circuit_breakers WHERE endpoint_id = $1`, [endpointId]);
        if (res.rows.length === 0) {
            // Initialize default circuit
            const initRes = await (0, client_1.query)(`INSERT INTO circuit_breakers (endpoint_id, state, failure_count, success_count)
         VALUES ($1, 'CLOSED', 0, 0)
         RETURNING endpoint_id as "endpointId", state, failure_count as "failureCount",
                   success_count as "successCount", threshold_failures as "thresholdFailures",
                   cool_down_seconds as "coolDownSeconds", opened_at as "openedAt",
                   last_failure_at as "lastFailureAt"`, [endpointId]);
            return initRes.rows[0];
        }
        return res.rows[0];
    }
    async canExecute(endpointId) {
        const circuit = await this.getCircuit(endpointId);
        if (circuit.state === 'CLOSED') {
            return true;
        }
        if (circuit.state === 'OPEN') {
            const openedAt = circuit.openedAt ? new Date(circuit.openedAt).getTime() : 0;
            const now = Date.now();
            const coolDownMs = circuit.coolDownSeconds * 1000;
            if (now - openedAt > coolDownMs) {
                // Transition to HALF_OPEN
                await (0, client_1.query)(`UPDATE circuit_breakers
           SET state = 'HALF_OPEN', updated_at = CURRENT_TIMESTAMP
           WHERE endpoint_id = $1`, [endpointId]);
                return true; // Trial request permitted
            }
            return false; // Still within cool-down
        }
        // HALF_OPEN: allow trial request
        return true;
    }
    async recordSuccess(endpointId) {
        const circuit = await this.getCircuit(endpointId);
        if (circuit.state === 'HALF_OPEN') {
            // Trial succeeded, close circuit
            await (0, client_1.query)(`UPDATE circuit_breakers
         SET state = 'CLOSED', failure_count = 0, success_count = 0, opened_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`, [endpointId]);
        }
        else if (circuit.state === 'CLOSED' && circuit.failureCount > 0) {
            // Reset failure count on success
            await (0, client_1.query)(`UPDATE circuit_breakers
         SET failure_count = 0, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`, [endpointId]);
        }
    }
    async recordFailure(endpointId) {
        const circuit = await this.getCircuit(endpointId);
        const newFailures = circuit.failureCount + 1;
        if (circuit.state === 'HALF_OPEN' || newFailures >= circuit.thresholdFailures) {
            // Trip the circuit to OPEN
            await (0, client_1.query)(`UPDATE circuit_breakers
         SET state = 'OPEN', failure_count = $2, opened_at = CURRENT_TIMESTAMP,
             last_failure_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`, [endpointId, newFailures]);
            return 'OPEN';
        }
        else {
            // Increment failure count
            await (0, client_1.query)(`UPDATE circuit_breakers
         SET failure_count = $2, last_failure_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE endpoint_id = $1`, [endpointId, newFailures]);
            return circuit.state;
        }
    }
    async resetCircuit(endpointId) {
        await (0, client_1.query)(`UPDATE circuit_breakers
       SET state = 'CLOSED', failure_count = 0, success_count = 0, opened_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE endpoint_id = $1`, [endpointId]);
    }
}
exports.CircuitBreakerRegistry = CircuitBreakerRegistry;
exports.circuitBreaker = new CircuitBreakerRegistry();

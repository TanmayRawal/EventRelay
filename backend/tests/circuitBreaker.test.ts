import { CircuitBreakerRegistry, CircuitRecord } from '../src/resilience/circuitBreaker';
import * as db from '../src/db/client';

// In-memory mock database store for circuit breakers
const store = new Map<string, any>();

jest.mock('../src/db/client', () => ({
  query: jest.fn(async (sql: string, params: any[]) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    // SELECT
    if (normalized.startsWith('SELECT')) {
      const endpointId = params[0];
      const record = store.get(endpointId);
      return { rows: record ? [record] : [] };
    }

    // INSERT
    if (normalized.startsWith('INSERT INTO circuit_breakers')) {
      const endpointId = params[0];
      const record = {
        endpointId,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        thresholdFailures: 5,
        coolDownSeconds: 30,
        openedAt: null,
        lastFailureAt: null
      };
      store.set(endpointId, record);
      return { rows: [record] };
    }

    // UPDATE
    if (normalized.startsWith('UPDATE circuit_breakers')) {
      const endpointId = params[0];
      const record = store.get(endpointId) || {
        endpointId,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        thresholdFailures: 5,
        coolDownSeconds: 30,
        openedAt: null,
        lastFailureAt: null
      };

      if (sql.includes("state = 'HALF_OPEN'")) {
        record.state = 'HALF_OPEN';
      } else if (sql.includes("state = 'CLOSED'")) {
        record.state = 'CLOSED';
        record.failureCount = 0;
        record.openedAt = null;
      } else if (sql.includes("state = 'OPEN'")) {
        record.state = 'OPEN';
        record.failureCount = params[1];
        record.openedAt = new Date();
      } else if (sql.includes('failure_count = $2')) {
        record.failureCount = params[1];
      }

      store.set(endpointId, record);
      return { rows: [record] };
    }

    return { rows: [] };
  })
}));

describe('CircuitBreakerRegistry (Stateful Resilience Engine)', () => {
  const cb = new CircuitBreakerRegistry();
  const endpointId = 'ep-vendor-stripe-999';

  beforeEach(() => {
    store.clear();
  });

  it('should initialize in CLOSED state and permit execution', async () => {
    const allowed = await cb.canExecute(endpointId);
    expect(allowed).toBe(true);

    const circuit = await cb.getCircuit(endpointId);
    expect(circuit.state).toBe('CLOSED');
    expect(circuit.failureCount).toBe(0);
  });

  it('should increment failure count on consecutive failures', async () => {
    await cb.recordFailure(endpointId);
    await cb.recordFailure(endpointId);

    const circuit = await cb.getCircuit(endpointId);
    expect(circuit.failureCount).toBe(2);
    expect(circuit.state).toBe('CLOSED');
  });

  it('should trip to OPEN when failure count reaches threshold (5 failures)', async () => {
    for (let i = 1; i <= 4; i++) {
      const state = await cb.recordFailure(endpointId);
      expect(state).toBe('CLOSED');
    }

    // 5th failure should trip circuit
    const finalState = await cb.recordFailure(endpointId);
    expect(finalState).toBe('OPEN');

    const circuit = await cb.getCircuit(endpointId);
    expect(circuit.state).toBe('OPEN');
    expect(circuit.failureCount).toBe(5);
  });

  it('should fast-fail execution in OPEN state without network calls', async () => {
    // Trip circuit to OPEN
    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(endpointId);
    }

    // Within cool-down period: must reject immediately
    const allowed = await cb.canExecute(endpointId);
    expect(allowed).toBe(false);
  });

  it('should transition to HALF_OPEN after cooldown expires', async () => {
    // Trip circuit to OPEN
    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(endpointId);
    }

    // Manually backdate openedAt past 30 seconds cooldown
    const record = store.get(endpointId);
    record.openedAt = new Date(Date.now() - 35000);
    store.set(endpointId, record);

    // Trial execution probe should now be permitted
    const allowed = await cb.canExecute(endpointId);
    expect(allowed).toBe(true);

    const updated = await cb.getCircuit(endpointId);
    expect(updated.state).toBe('HALF_OPEN');
  });

  it('should close circuit and reset failures when trial request in HALF_OPEN succeeds', async () => {
    // Set to HALF_OPEN
    const record = {
      endpointId,
      state: 'HALF_OPEN',
      failureCount: 5,
      thresholdFailures: 5,
      coolDownSeconds: 30,
      openedAt: new Date(Date.now() - 35000)
    };
    store.set(endpointId, record);

    await cb.recordSuccess(endpointId);

    const recovered = await cb.getCircuit(endpointId);
    expect(recovered.state).toBe('CLOSED');
    expect(recovered.failureCount).toBe(0);
  });

  it('should immediately re-open circuit if trial request in HALF_OPEN fails', async () => {
    const record = {
      endpointId,
      state: 'HALF_OPEN',
      failureCount: 5,
      thresholdFailures: 5,
      coolDownSeconds: 30,
      openedAt: new Date(Date.now() - 35000)
    };
    store.set(endpointId, record);

    const nextState = await cb.recordFailure(endpointId);
    expect(nextState).toBe('OPEN');

    const tripped = await cb.getCircuit(endpointId);
    expect(tripped.state).toBe('OPEN');
  });

  it('should support administrative manual reset back to CLOSED', async () => {
    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(endpointId);
    }
    expect((await cb.getCircuit(endpointId)).state).toBe('OPEN');

    await cb.resetCircuit(endpointId);

    const resetRecord = await cb.getCircuit(endpointId);
    expect(resetRecord.state).toBe('CLOSED');
    expect(resetRecord.failureCount).toBe(0);
  });
});

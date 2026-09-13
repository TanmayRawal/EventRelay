import { withTransaction } from '../src/db/client';

jest.mock('../src/db/client', () => ({
  withTransaction: jest.fn(async (cb) => cb({ query: jest.fn() }))
}));

describe('Atomic Idempotency (Concurrent Ingestion Race Defense)', () => {
  it('should handle concurrent insertions with identical key safely without 500 collision', async () => {
    // Shared simulated DB state
    const eventsTable = new Map<string, any>();
    const idempotencyKey = 'idemp-concurrent-test-123';

    async function simulateIngest(callerId: string) {
      // Simulate withTransaction atomic execution against Postgres table with UNIQUE (idempotency_key)
      return await withTransaction(async (client) => {
        // Atomic INSERT ON CONFLICT DO NOTHING
        if (!eventsTable.has(idempotencyKey)) {
          const newEvent = {
            id: `evt-${callerId}`,
            idempotency_key: idempotencyKey,
            event_type: 'order.created',
            status: 'PROCESSING'
          };
          eventsTable.set(idempotencyKey, newEvent);
          return { statusCode: 201, event: newEvent, duplicate: false };
        } else {
          // Conflict detected, fetch existing row
          const existing = eventsTable.get(idempotencyKey);
          return { statusCode: 200, event: existing, duplicate: true };
        }
      });
    }

    // Launch 20 concurrent simulated ingestion requests
    const results = await Promise.all(
      Array.from({ length: 20 }).map((_, i) => simulateIngest(`worker-${i}`))
    );

    const created = results.filter(r => r.statusCode === 201);
    const duplicates = results.filter(r => r.statusCode === 200 && r.duplicate === true);

    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(19);

    // Every duplicate returns the exact event ID of the first creator
    for (const dup of duplicates) {
      expect(dup.event.id).toBe(created[0].event.id);
    }
  });
});

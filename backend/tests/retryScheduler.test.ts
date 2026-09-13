import { RetryScheduler } from '../src/worker/retryScheduler';
import { withTransaction, query } from '../src/db/client';
import { outboxPublisher } from '../src/worker/outboxPublisher';
import { metrics } from '../src/metrics/prometheus';

jest.mock('../src/db/client', () => ({
  withTransaction: jest.fn(),
  query: jest.fn()
}));

jest.mock('../src/worker/outboxPublisher', () => ({
  outboxPublisher: {
    poke: jest.fn()
  }
}));

jest.mock('../src/metrics/prometheus', () => ({
  metrics: {
    incDlq: jest.fn()
  }
}));

describe('RetryScheduler (Background Retry Engine)', () => {
  let scheduler: RetryScheduler;

  beforeEach(() => {
    scheduler = new RetryScheduler(100);
    jest.clearAllMocks();
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('should return 0 when no deliveries are due for retry', async () => {
    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] })
      };
      return cb(mockClient);
    });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(0);
    expect(outboxPublisher.poke).not.toHaveBeenCalled();
  });

  it('should re-enqueue due delivery via Transactional Outbox with FOR UPDATE SKIP LOCKED', async () => {
    const mockDueDelivery = {
      id: 'del-uuid-001',
      event_id: 'evt-uuid-001',
      endpoint_id: 'ep-uuid-001',
      attempt_number: 1,
      ordering_key: 'tenant_customer_42',
      max_retries: 3
    };

    let clientQueries: { sql: string; params: any[] }[] = [];

    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          clientQueries.push({ sql, params });
          if (sql.includes('SELECT')) return Promise.resolve({ rows: [mockDueDelivery] });
          return Promise.resolve({ rowCount: 1, rows: [] });
        })
      };
      return cb(mockClient);
    });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(1);

    // Verify FOR UPDATE SKIP LOCKED query was executed
    expect(clientQueries[0].sql).toContain('FOR UPDATE SKIP LOCKED');

    // Verify DB update incremented attempt_number
    const updateQuery = clientQueries.find(q => q.sql.includes('UPDATE deliveries'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.params).toEqual([2, 'del-uuid-001']);

    // Verify write to outbox table inside the transaction
    const outboxQuery = clientQueries.find(q => q.sql.includes('INSERT INTO outbox'));
    expect(outboxQuery).toBeDefined();
    expect(outboxQuery?.params).toEqual(['del-uuid-001', 'evt-uuid-001', 'ep-uuid-001', 2, 'tenant_customer_42']);

    expect(outboxPublisher.poke).toHaveBeenCalled();
  });

  it('should transition delivery to DEAD_LETTER and increment DLQ metric when max retries exceeded', async () => {
    const mockExhaustedDelivery = {
      id: 'del-uuid-dead-002',
      event_id: 'evt-uuid-002',
      endpoint_id: 'ep-uuid-002',
      attempt_number: 3,
      ordering_key: 'tenant_customer_99',
      max_retries: 3
    };

    let clientQueries: { sql: string; params: any[] }[] = [];

    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          clientQueries.push({ sql, params });
          if (sql.includes('SELECT')) return Promise.resolve({ rows: [mockExhaustedDelivery] });
          return Promise.resolve({ rowCount: 1, rows: [] });
        })
      };
      return cb(mockClient);
    });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(1);

    // Verify DB updated to DEAD_LETTER
    const dlqUpdate = clientQueries.find(q => q.sql.includes("SET status = 'DEAD_LETTER'"));
    expect(dlqUpdate).toBeDefined();
    expect(dlqUpdate?.params).toEqual(['del-uuid-dead-002']);

    expect(metrics.incDlq).toHaveBeenCalled();

    // Must NOT write to outbox for dead-lettered job
    const outboxQuery = clientQueries.find(q => q.sql.includes('INSERT INTO outbox'));
    expect(outboxQuery).toBeUndefined();
  });

  it('should gracefully handle database query failure without throwing', async () => {
    (withTransaction as jest.Mock).mockRejectedValueOnce(new Error('PostgreSQL connection drop'));

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(0);
  });

  it('should start and stop timer correctly', () => {
    scheduler.start();
    // Starting twice should be a no-op
    scheduler.start();

    scheduler.stop();
    // Stopping twice should be a no-op
    scheduler.stop();
  });
});

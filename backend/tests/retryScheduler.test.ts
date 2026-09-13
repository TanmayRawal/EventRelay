import { RetryScheduler } from '../src/worker/retryScheduler';
import { query } from '../src/db/client';
import { streamQueue } from '../src/redis/streamQueue';
import { metrics } from '../src/metrics/prometheus';

jest.mock('../src/db/client', () => ({
  query: jest.fn()
}));

jest.mock('../src/redis/streamQueue', () => ({
  streamQueue: {
    publish: jest.fn().mockResolvedValue('msg-id-123')
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
    (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(0);
    expect(streamQueue.publish).not.toHaveBeenCalled();
  });

  it('should re-enqueue due delivery preserving orderingKey on shard', async () => {
    const mockDueDelivery = {
      id: 'del-uuid-001',
      event_id: 'evt-uuid-001',
      endpoint_id: 'ep-uuid-001',
      attempt_number: 1,
      ordering_key: 'tenant_customer_42',
      max_retries: 3
    };

    // First query returns the due delivery
    (query as jest.Mock).mockResolvedValueOnce({ rows: [mockDueDelivery] });
    // Second query is the UPDATE query
    (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(1);

    // Verify DB update incremented attempt_number
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE deliveries\n             SET attempt_number = $1'),
      [2, 'del-uuid-001']
    );

    // Verify publish called with correct shard ordering key
    expect(streamQueue.publish).toHaveBeenCalledWith(
      {
        deliveryId: 'del-uuid-001',
        eventId: 'evt-uuid-001',
        endpointId: 'ep-uuid-001',
        attemptNumber: 2
      },
      'tenant_customer_42'
    );
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

    // Next attempt (4) > max_retries (3)
    (query as jest.Mock).mockResolvedValueOnce({ rows: [mockExhaustedDelivery] });
    (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

    const processed = await scheduler.pollAndReenqueue();

    expect(processed).toBe(1);

    // Verify DB updated to DEAD_LETTER
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'DEAD_LETTER'"),
      ['del-uuid-dead-002']
    );

    // Verify DLQ metric incremented
    expect(metrics.incDlq).toHaveBeenCalled();

    // Must NOT publish to stream queue
    expect(streamQueue.publish).not.toHaveBeenCalled();
  });

  it('should gracefully handle database query failure without throwing', async () => {
    (query as jest.Mock).mockRejectedValueOnce(new Error('PostgreSQL connection drop'));

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

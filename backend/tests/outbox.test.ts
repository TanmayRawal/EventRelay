import { OutboxPublisher } from '../src/worker/outboxPublisher';
import { withTransaction } from '../src/db/client';
import { streamQueue } from '../src/redis/streamQueue';

jest.mock('../src/db/client', () => ({
  withTransaction: jest.fn(),
  query: jest.fn()
}));

jest.mock('../src/redis/streamQueue', () => ({
  streamQueue: {
    publish: jest.fn()
  }
}));

describe('OutboxPublisher (Transactional Outbox Relaying)', () => {
  let publisher: OutboxPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new OutboxPublisher(100);
  });

  afterEach(() => {
    publisher.stop();
  });

  it('should return 0 when no outbox items are pending', async () => {
    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] })
      };
      return cb(mockClient);
    });

    const drained = await publisher.drain();
    expect(drained).toBe(0);
    expect(streamQueue.publish).not.toHaveBeenCalled();
  });

  it('should drain pending outbox records to Redis Streams and delete them atomically', async () => {
    const mockRows = [
      {
        id: 'outbox-1',
        delivery_id: 'del-1',
        event_id: 'evt-1',
        endpoint_id: 'ep-1',
        attempt_number: 1,
        ordering_key: 'acc_001'
      },
      {
        id: 'outbox-2',
        delivery_id: 'del-2',
        event_id: 'evt-1',
        endpoint_id: 'ep-2',
        attempt_number: 1,
        ordering_key: 'acc_001'
      }
    ];

    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: mockRows }) // SELECT ... FOR UPDATE SKIP LOCKED
          .mockResolvedValueOnce({ rowCount: 2 })    // DELETE FROM outbox
      };
      return cb(mockClient);
    });

    (streamQueue.publish as jest.Mock).mockResolvedValue({ messageId: '123-0', streamName: 'shard:0' });

    const drained = await publisher.drain();

    expect(drained).toBe(2);
    expect(streamQueue.publish).toHaveBeenCalledTimes(2);
    expect(streamQueue.publish).toHaveBeenCalledWith(
      { deliveryId: 'del-1', eventId: 'evt-1', endpointId: 'ep-1', attemptNumber: 1 },
      'acc_001'
    );
  });

  it('should stop batch and preserve remaining outbox items if Redis publish fails', async () => {
    const mockRows = [
      { id: 'outbox-1', delivery_id: 'del-1', event_id: 'evt-1', endpoint_id: 'ep-1', attempt_number: 1, ordering_key: null },
      { id: 'outbox-2', delivery_id: 'del-2', event_id: 'evt-2', endpoint_id: 'ep-2', attempt_number: 1, ordering_key: null }
    ];

    let deleteCalledWith: any[] = [];

    (withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql.includes('SELECT')) return Promise.resolve({ rows: mockRows });
          if (sql.includes('DELETE')) {
            deleteCalledWith = params[0];
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        })
      };
      return cb(mockClient);
    });

    // First publish succeeds, second throws
    (streamQueue.publish as jest.Mock)
      .mockResolvedValueOnce({ messageId: '1-0', streamName: 'stream' })
      .mockRejectedValueOnce(new Error('Redis connection drop'));

    const drained = await publisher.drain();

    expect(drained).toBe(1);
    // Only the first successfully published item was deleted; second remains in outbox for recovery
    expect(deleteCalledWith).toEqual(['outbox-1']);
  });
});

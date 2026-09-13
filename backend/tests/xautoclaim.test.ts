import { streamQueue } from '../src/redis/streamQueue';
import { redis } from '../src/redis/client';

jest.mock('../src/redis/client', () => ({
  redis: {
    xautoclaim: jest.fn(),
    xreadgroup: jest.fn(),
    xack: jest.fn(),
    xgroup: jest.fn()
  }
}));

describe('XAUTOCLAIM Pending Message Recovery (PEL Reclaim)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call Redis xautoclaim and return parsed delivery messages from PEL', async () => {
    const mockXautoclaimResponse = [
      '0-0', // next start ID
      [
        [
          '1700000000000-0',
          [
            'deliveryId', 'del-crashed-1',
            'eventId', 'evt-crashed-1',
            'endpointId', 'ep-1',
            'attemptNumber', '1'
          ]
        ]
      ]
    ];

    (redis as any).xautoclaim = jest.fn().mockResolvedValue(mockXautoclaimResponse);

    const messages = await streamQueue.autoClaimPending(
      'eventrelay:stream:shard:0',
      'worker-healthy-1',
      30000,
      10
    );

    expect((redis as any).xautoclaim).toHaveBeenCalledWith(
      'eventrelay:stream:shard:0',
      'eventrelay-workers-group',
      'worker-healthy-1',
      30000,
      '0-0',
      'COUNT',
      10
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('1700000000000-0');
    expect(messages[0].job.deliveryId).toBe('del-crashed-1');
  });

  it('should return empty array when no pending messages exist', async () => {
    (redis as any).xautoclaim = jest.fn().mockResolvedValue(['0-0', []]);

    const messages = await streamQueue.autoClaimPending(
      'eventrelay:stream:shard:0',
      'worker-1',
      30000,
      10
    );

    expect(messages).toEqual([]);
  });

  it('should handle Redis error gracefully and return empty array', async () => {
    (redis as any).xautoclaim = jest.fn().mockRejectedValue(new Error('Redis connection drop'));

    const messages = await streamQueue.autoClaimPending(
      'eventrelay:stream:shard:0',
      'worker-1',
      30000,
      10
    );

    expect(messages).toEqual([]);
  });
});

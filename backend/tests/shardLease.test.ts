import { ShardLeaseCoordinator } from '../src/worker/shardLeaseCoordinator';
import { redis } from '../src/redis/client';

jest.mock('../src/redis/client', () => ({
  redis: {
    set: jest.fn(),
    eval: jest.fn()
  }
}));

describe('ShardLeaseCoordinator (Partition Ownership & FIFO Guarantee)', () => {
  let coordinator: ShardLeaseCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    coordinator = new ShardLeaseCoordinator('worker-test-1', 4, 15);
  });

  afterEach(async () => {
    coordinator.stop();
  });

  it('should claim available shards using Redis NX EX', async () => {
    // Simulate shards 0, 1 acquired, 2, 3 contested by another worker
    (redis.set as jest.Mock)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await coordinator.start();

    const owned = coordinator.getOwnedShards();
    expect(owned).toEqual([0, 1]);
    expect(redis.set).toHaveBeenCalledTimes(4);
    expect(redis.set).toHaveBeenCalledWith('lock:shard:0', 'worker-test-1', 'EX', 15, 'NX');
  });

  it('should release all owned shard leases on stop', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.eval as jest.Mock).mockResolvedValue(1);

    await coordinator.start();
    expect(coordinator.getOwnedShards()).toHaveLength(4);

    await coordinator.releaseAll();
    expect(coordinator.getOwnedShards()).toHaveLength(0);
    expect(redis.eval).toHaveBeenCalledTimes(4);
  });
});

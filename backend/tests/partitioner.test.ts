import { StreamPartitioner } from '../src/sharding/partitioner';

describe('StreamPartitioner', () => {
  const partitioner = new StreamPartitioner(8);

  it('should deterministically map the same ordering key to the exact same shard', () => {
    const key = 'user_account_98765';
    const stream1 = partitioner.getShardStreamName(key, 'eventrelay:stream');
    const stream2 = partitioner.getShardStreamName(key, 'eventrelay:stream');

    expect(stream1).toBe(stream2);
    expect(stream1).toMatch(/^eventrelay:stream:shard:[0-7]$/);
  });

  it('should map different keys to distributed shards between 0 and shardCount-1', () => {
    const shards = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const stream = partitioner.getShardStreamName(`entity_${i}`, 'eventrelay:stream');
      shards.add(stream);
    }

    // With 100 distinct keys and 8 shards, all or nearly all shards should be utilized
    expect(shards.size).toBeGreaterThanOrEqual(6);
  });

  it('should fall back to baseStream if no orderingKey is supplied', () => {
    const stream = partitioner.getShardStreamName(null, 'eventrelay:stream');
    expect(stream).toBe('eventrelay:stream');
  });

  it('should return all shard stream names correctly', () => {
    const all = partitioner.getAllShardStreams('eventrelay:stream');
    expect(all).toHaveLength(8);
    expect(all[0]).toBe('eventrelay:stream:shard:0');
    expect(all[7]).toBe('eventrelay:stream:shard:7');
  });
});

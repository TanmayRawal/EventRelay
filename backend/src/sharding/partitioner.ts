/**
 * Partitioner for FIFO Message Ordering via Virtual Stream Sharding.
 * Uses FNV-1a (Fowler-Noll-Vo) 32-bit hash algorithm to map arbitrary
 * entity keys (e.g., accountId, orderId, customerId) deterministically to a shard.
 */
export class StreamPartitioner {
  private shardCount: number;

  constructor(shardCount: number = 8) {
    this.shardCount = shardCount;
  }

  /**
   * Deterministic 32-bit FNV-1a hash algorithm.
   */
  hashKey(key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  /**
   * Returns the partitioned stream name for a given ordering key.
   * Format: eventrelay:stream:shard:{shardIndex}
   */
  getShardStreamName(orderingKey: string | null | undefined, baseStream: string): string {
    if (!orderingKey) {
      // Default to unpartitioned stream or random shard
      return baseStream;
    }
    const hash = this.hashKey(orderingKey);
    const shardIndex = hash % this.shardCount;
    return `${baseStream}:shard:${shardIndex}`;
  }

  getShardCount(): number {
    return this.shardCount;
  }

  getAllShardStreams(baseStream: string): string[] {
    const streams: string[] = [];
    for (let i = 0; i < this.shardCount; i++) {
      streams.push(`${baseStream}:shard:${i}`);
    }
    return streams;
  }
}

export const partitioner = new StreamPartitioner(8);

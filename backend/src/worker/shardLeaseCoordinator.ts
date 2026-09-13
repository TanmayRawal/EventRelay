import { redis } from '../redis/client';
import { partitioner } from '../sharding/partitioner';

const RENEW_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  else
    return 0
  end
`;

const RELEASE_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

export class ShardLeaseCoordinator {
  private workerId: string;
  private shardCount: number;
  private leaseTtlSeconds: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ownedShards: Set<number> = new Set();
  private isRunning: boolean = false;

  constructor(workerId: string, shardCount: number = 8, leaseTtlSeconds: number = 15) {
    this.workerId = workerId;
    this.shardCount = shardCount;
    this.leaseTtlSeconds = leaseTtlSeconds;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[ShardLease] Initializing coordinator for worker '${this.workerId}' across ${this.shardCount} shards...`);

    // Initial attempt to acquire available shards
    await this.claimAvailableShards();

    // Heartbeat every 5 seconds to renew leases and claim newly freed shards
    this.heartbeatTimer = setInterval(async () => {
      await this.heartbeat();
    }, 5000);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isRunning = false;
  }

  async releaseAll(): Promise<void> {
    this.stop();
    for (const shardId of this.ownedShards) {
      try {
        const lockKey = `lock:shard:${shardId}`;
        await redis.eval(RELEASE_LUA, 1, lockKey, this.workerId);
      } catch (err: any) {
        console.warn(`[ShardLease] Failed to release lease for shard ${shardId}:`, err.message);
      }
    }
    this.ownedShards.clear();
    console.log(`[ShardLease] Released all shard leases for worker '${this.workerId}'.`);
  }

  getOwnedShards(): number[] {
    return Array.from(this.ownedShards).sort((a, b) => a - b);
  }

  private async claimAvailableShards(): Promise<void> {
    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      if (this.ownedShards.has(shardId)) continue;

      const lockKey = `lock:shard:${shardId}`;
      try {
        // Attempt to acquire lease if unheld
        const acquired = await redis.set(lockKey, this.workerId, 'EX', this.leaseTtlSeconds, 'NX');
        if (acquired === 'OK') {
          this.ownedShards.add(shardId);
          console.log(`[ShardLease] Worker '${this.workerId}' acquired lease for Shard #${shardId}`);
        }
      } catch (err: any) {
        console.warn(`[ShardLease] Lease claim error on shard ${shardId}:`, err.message);
      }
    }
  }

  private async heartbeat(): Promise<void> {
    // 1. Renew existing leases
    for (const shardId of Array.from(this.ownedShards)) {
      const lockKey = `lock:shard:${shardId}`;
      try {
        const renewed = await redis.eval(RENEW_LUA, 1, lockKey, this.workerId, this.leaseTtlSeconds.toString());
        if (renewed !== 1) {
          console.warn(`[ShardLease] Worker '${this.workerId}' lost lease for Shard #${shardId}`);
          this.ownedShards.delete(shardId);
        }
      } catch (err: any) {
        console.warn(`[ShardLease] Error renewing lease for Shard #${shardId}:`, err.message);
      }
    }

    // 2. Try to acquire any unowned/abandoned shards
    await this.claimAvailableShards();
  }
}

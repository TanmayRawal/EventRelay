import { redis } from '../redis/client';

export class TokenBucketRateLimiter {
  /**
   * Evaluates token consumption using atomic Redis operations.
   * Returns true if request is permitted under quota, false if rate limited.
   */
  async consume(key: string, capacity: number, refillRatePerSec: number): Promise<boolean> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();

    // Lua script for atomic token bucket check & decrement
    const luaScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])

      local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(data[1])
      local lastRefill = tonumber(data[2])

      if not tokens then
        tokens = capacity
        lastRefill = now
      else
        local deltaSec = (now - lastRefill) / 1000.0
        tokens = math.min(capacity, tokens + deltaSec * refillRate)
        lastRefill = now
      end

      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, 60)
        return 1
      else
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, 60)
        return 0
      end
    `;

    try {
      const result = await redis.eval(
        luaScript,
        1,
        redisKey,
        capacity.toString(),
        refillRatePerSec.toString(),
        now.toString()
      );
      return result === 1;
    } catch (err) {
      console.warn('[RateLimiter] Redis rate limiter fallback to allow:', err);
      return true;
    }
  }
}

export const rateLimiter = new TokenBucketRateLimiter();

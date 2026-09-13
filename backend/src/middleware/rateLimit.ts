import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis/client';
import { config } from '../config';
import { metrics } from '../metrics/prometheus';

// In-memory fallback in case of Redis disruption
interface LocalBucket {
  tokens: number;
  lastRefill: number;
}
const localBuckets = new Map<string, LocalBucket>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of localBuckets.entries()) {
    if (now - entry.lastRefill > 60000) {
      localBuckets.delete(key);
    }
  }
}, 300000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

const INBOUND_RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
  local tokens = tonumber(data[1])
  local lastRefill = tonumber(data[2])

  if not tokens or not lastRefill then
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
    return { 1, math.floor(tokens) }
  else
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, 60)
    return { 0, 0 }
  end
`;

/**
 * Distributed Inbound Token Bucket Rate Limiter.
 * Coordinates token state atomically across all backend gateway instances using Redis.
 * Degrades gracefully to process-local bucket on Redis network disruption.
 */
export async function inboundRateLimiter(req: Request, res: Response, next: NextFunction) {
  const caller = req.header('X-API-Key') || req.ip || 'global';
  const capacity = config.ingestionRateLimitRps;
  const refillRate = capacity;
  const now = Date.now();

  try {
    const redisKey = `ratelimit:inbound:${caller}`;
    const result = (await redis.eval(
      INBOUND_RATE_LIMIT_LUA,
      1,
      redisKey,
      capacity.toString(),
      refillRate.toString(),
      now.toString()
    )) as [number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];

    res.setHeader('X-RateLimit-Limit', capacity.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    if (allowed) {
      return next();
    }

    res.setHeader('Retry-After', '1');
    return res.status(429).json({
      error: 'Too Many Requests. Ingestion rate limit exceeded.',
      retryAfterSeconds: 1
    });
  } catch (err: any) {
    metrics.incRateLimiterError();
    console.warn('[InboundRateLimiter] Redis error, falling back to in-memory bucket:', err.message);

    let bucket = localBuckets.get(caller);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      localBuckets.set(caller, bucket);
    } else {
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      res.setHeader('X-RateLimit-Limit', capacity.toString());
      res.setHeader('X-RateLimit-Remaining', Math.floor(bucket.tokens).toString());
      return next();
    }

    res.setHeader('Retry-After', '1');
    return res.status(429).json({
      error: 'Too Many Requests. Ingestion rate limit exceeded.',
      retryAfterSeconds: 1
    });
  }
}

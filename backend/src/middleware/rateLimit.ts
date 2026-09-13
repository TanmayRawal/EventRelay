import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const callerBuckets = new Map<string, RateLimitEntry>();

// Clean up stale buckets every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of callerBuckets.entries()) {
    if (now - entry.lastRefill > 60000) {
      callerBuckets.delete(key);
    }
  }
}, 300000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Inbound Token Bucket Rate Limiter for Ingestion Protection.
 * Throttles ingestion per caller (identified by API key or IP address)
 * to prevent gateway flooding and socket starvation.
 */
export function inboundRateLimiter(req: Request, res: Response, next: NextFunction) {
  const caller = req.header('X-API-Key') || req.ip || 'global';
  const now = Date.now();
  const capacity = config.ingestionRateLimitRps;
  const refillRate = capacity;

  let bucket = callerBuckets.get(caller);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    callerBuckets.set(caller, bucket);
  } else {
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillRate);
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
    error: 'Too Many Requests. Gateway ingestion rate limit exceeded.',
    retryAfterSeconds: 1
  });
}

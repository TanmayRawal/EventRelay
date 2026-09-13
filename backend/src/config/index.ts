import dotenv from 'dotenv';
dotenv.config();

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = process.env.PGUSER || 'eventrelay';
  const pass = process.env.PGPASSWORD || '';
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  const db = process.env.PGDATABASE || 'eventrelay_db';
  const auth = pass ? `${user}:${pass}@` : `${user}@`;
  return `postgres://${auth}${host}:${port}/${db}`;
}

const rawApiKey = process.env.EVENTRELAY_API_KEY ? process.env.EVENTRELAY_API_KEY.trim() : null;

// Fail-closed security: In production, require an explicit API key to start
if (process.env.NODE_ENV === 'production' && !rawApiKey) {
  console.error('[EventRelay:FATAL] Missing required EVENTRELAY_API_KEY in production mode. Refusing to start in open unauthenticated mode.');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: getDatabaseUrl(),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  apiKey: rawApiKey,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  ingestionRateLimitRps: parseInt(process.env.INGESTION_RATE_LIMIT_RPS || '200', 10),
  rateLimiterFailClosed: process.env.RATE_LIMITER_FAIL_CLOSED === 'true',
  streamName: process.env.STREAM_NAME || 'eventrelay:deliveries:stream',
  consumerGroup: 'eventrelay-workers-group',
  consumerName: `worker-${process.pid}`,
  maxRetriesDefault: parseInt(process.env.MAX_RETRIES || '5', 10),
  circuitThreshold: parseInt(process.env.CIRCUIT_THRESHOLD || '5', 10),
  circuitCoolDownSeconds: parseInt(process.env.CIRCUIT_COOLDOWN_SECONDS || '30', 10)
};

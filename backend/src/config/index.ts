import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://eventrelay:eventrelay_secret@localhost:5432/eventrelay_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  streamName: 'eventrelay:deliveries:stream',
  consumerGroup: 'eventrelay-workers-group',
  consumerName: `worker-${process.pid}`,
  maxRetriesDefault: 5,
  circuitThreshold: 5,
  circuitCoolDownSeconds: 30
};

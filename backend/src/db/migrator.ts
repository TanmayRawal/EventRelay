import { pool, withTransaction } from './client';

export interface Migration {
  version: string;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: '001',
    name: 'initial_schema',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS endpoints (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          url VARCHAR(2048) NOT NULL,
          secret_key VARCHAR(255) NOT NULL,
          rate_limit_rps INTEGER NOT NULL DEFAULT 50,
          max_retries INTEGER NOT NULL DEFAULT 5,
          timeout_ms INTEGER NOT NULL DEFAULT 5000,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS events (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          idempotency_key VARCHAR(128) UNIQUE NOT NULL,
          event_type VARCHAR(128) NOT NULL,
          payload JSONB NOT NULL,
          ordering_key VARCHAR(255),
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_idempotency ON events(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_events_ordering_key ON events(ordering_key);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

      CREATE TABLE IF NOT EXISTS deliveries (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL DEFAULT 1,
          http_status INTEGER,
          response_body TEXT,
          duration_ms INTEGER,
          error_message TEXT,
          status VARCHAR(32) NOT NULL DEFAULT 'RETRYING',
          next_retry_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_deliveries_event_id ON deliveries(event_id);
      CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_status ON deliveries(endpoint_id, status);
      CREATE INDEX IF NOT EXISTS idx_deliveries_retry ON deliveries(status, next_retry_at);

      CREATE TABLE IF NOT EXISTS circuit_breakers (
          endpoint_id UUID PRIMARY KEY REFERENCES endpoints(id) ON DELETE CASCADE,
          state VARCHAR(32) NOT NULL DEFAULT 'CLOSED',
          failure_count INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          threshold_failures INTEGER NOT NULL DEFAULT 5,
          cool_down_seconds INTEGER NOT NULL DEFAULT 30,
          opened_at TIMESTAMP WITH TIME ZONE,
          last_failure_at TIMESTAMP WITH TIME ZONE,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    version: '002',
    name: 'add_outbox_and_subscriptions',
    sql: `
      ALTER TABLE endpoints
      ADD COLUMN IF NOT EXISTS subscribed_events TEXT[] NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS outbox (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
          event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL DEFAULT 1,
          ordering_key VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at);
    `
  },
  {
    version: '003',
    name: 'add_no_targets_status',
    sql: `
      COMMENT ON COLUMN events.status IS 'PENDING, PROCESSING, COMPLETED, FAILED, PARTIAL_SUCCESS, NO_TARGETS';
    `
  },
  {
    version: '004',
    name: 'align_circuit_breakers',
    sql: `
      ALTER TABLE circuit_breakers
      ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS threshold_failures INTEGER NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS cool_down_seconds INTEGER NOT NULL DEFAULT 30,
      ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `
  }
];

export async function runMigrations(): Promise<number> {
  console.log('[Migrator] Initializing database migration check...');

  // Ensure schema_migrations table exists
  await withTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  // Query already applied migration versions
  const appliedRes = await pool.query<{ version: string }>(
    `SELECT version FROM schema_migrations ORDER BY version ASC`
  );
  const appliedVersions = new Set(appliedRes.rows.map((r) => r.version));

  let appliedCount = 0;

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[Migrator] Applying migration ${migration.version}_${migration.name}...`);
      await withTransaction(async (client) => {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name]
        );
      });
      appliedCount++;
      console.log(`[Migrator] Migration ${migration.version}_${migration.name} successfully applied.`);
    }
  }

  if (appliedCount === 0) {
    console.log('[Migrator] Database schema is up to date (no pending migrations).');
  } else {
    console.log(`[Migrator] Successfully applied ${appliedCount} migration(s).`);
  }

  return appliedCount;
}

// Allow direct execution via CLI: ts-node src/db/migrator.ts or node dist/db/migrator.js
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[Migrator] Migration process complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migrator] Migration failed with fatal error:', err);
      process.exit(1);
    });
}

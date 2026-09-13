-- EventRelay Database Schema
-- Relational schema with indexes, foreign keys, transactional outbox, and resilience states

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Endpoint Destinations
CREATE TABLE IF NOT EXISTS endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    secret_key VARCHAR(255) NOT NULL,
    rate_limit_rps INTEGER NOT NULL DEFAULT 50,
    max_retries INTEGER NOT NULL DEFAULT 5,
    timeout_ms INTEGER NOT NULL DEFAULT 5000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    subscribed_events TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ingested Events (Idempotency Key Guard & FIFO Sharding Key)
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    ordering_key VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED, PARTIAL_SUCCESS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_idempotency ON events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_events_ordering_key ON events(ordering_key);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- Delivery Attempts & Audit Log
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    http_status INTEGER,
    response_body TEXT,
    duration_ms INTEGER,
    error_message TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'RETRYING', -- SUCCESS, RETRYING, DEAD_LETTER
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deliveries_event_id ON deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_status ON deliveries(endpoint_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_retry ON deliveries(status, next_retry_at);

-- Transactional Outbox for Durable Dispatch
CREATE TABLE IF NOT EXISTS outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    ordering_key VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at ASC);

-- Circuit Breaker State per Endpoint
CREATE TABLE IF NOT EXISTS circuit_breakers (
    endpoint_id UUID PRIMARY KEY REFERENCES endpoints(id) ON DELETE CASCADE,
    state VARCHAR(32) NOT NULL DEFAULT 'CLOSED', -- CLOSED, OPEN, HALF_OPEN, HALF_OPEN_PROBING
    failure_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    threshold_failures INTEGER NOT NULL DEFAULT 5,
    cool_down_seconds INTEGER NOT NULL DEFAULT 30,
    opened_at TIMESTAMP WITH TIME ZONE,
    last_failure_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration 002: Add Transactional Outbox and Event Subscriptions

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

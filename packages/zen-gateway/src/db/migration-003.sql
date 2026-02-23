-- migration-003: Add provider_cost_cents to usage_logs for profit tracking
-- Run: bun x wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-003.sql

-- Store what we pay the provider separately from what we charge the user
ALTER TABLE usage_logs ADD COLUMN provider_cost_cents INTEGER DEFAULT 0;

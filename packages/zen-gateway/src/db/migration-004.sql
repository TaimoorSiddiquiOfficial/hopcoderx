-- Migration 004: Enhance api_keys with per-key limits, budget, and metadata
-- Run: wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-004.sql

-- Key expiry
ALTER TABLE api_keys ADD COLUMN expires_at TEXT DEFAULT NULL;

-- Model allowlist (JSON array of model_id strings, NULL = all allowed)
ALTER TABLE api_keys ADD COLUMN allowed_models TEXT DEFAULT NULL;

-- Per-key spend budget (0 = unlimited)
ALTER TABLE api_keys ADD COLUMN max_budget_cents INTEGER DEFAULT 0;

-- Budget reset period: '1d', '7d', '30d', NULL = no reset
ALTER TABLE api_keys ADD COLUMN budget_period TEXT DEFAULT NULL;

-- When the current budget period started
ALTER TABLE api_keys ADD COLUMN budget_start_at TEXT DEFAULT NULL;

-- Spend accumulated in the current budget period
ALTER TABLE api_keys ADD COLUMN budget_used_cents INTEGER DEFAULT 0;

-- Tokens-per-minute limit (0 = unlimited)
ALTER TABLE api_keys ADD COLUMN tpm_limit INTEGER DEFAULT 0;

-- Requests-per-minute limit (0 = unlimited, falls back to global setting)
ALTER TABLE api_keys ADD COLUMN rpm_limit INTEGER DEFAULT 0;

-- Optional human-readable note or label
ALTER TABLE api_keys ADD COLUMN note TEXT DEFAULT NULL;

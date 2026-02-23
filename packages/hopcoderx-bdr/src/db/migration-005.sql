-- Migration 005: Model aliases + request metadata + request body logging
-- Run: wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-005.sql

-- Store custom metadata tags on usage_logs (JSON object from x-hopcoderx-metadata header)
ALTER TABLE usage_logs ADD COLUMN metadata TEXT DEFAULT NULL;

-- Store x-hopcoderx-tag simple string for quick filtering
ALTER TABLE usage_logs ADD COLUMN tag TEXT DEFAULT NULL;

-- Store request/response body snippets for debugging (null unless log_bodies enabled)
ALTER TABLE usage_logs ADD COLUMN request_preview TEXT DEFAULT NULL;
ALTER TABLE usage_logs ADD COLUMN response_preview TEXT DEFAULT NULL;

-- Model aliases: "fastest" -> "openai/gpt-4o-mini", "smartest" -> "anthropic/claude-3-5-sonnet"
CREATE TABLE IF NOT EXISTS model_aliases (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,          -- e.g. "fastest", "code", "cheap"
  model_id TEXT NOT NULL,              -- resolves to this model_id in models table
  description TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_model_aliases_alias ON model_aliases(alias);

-- Routing rules: conditional routing based on metadata/params
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,          -- lower = evaluated first
  condition_field TEXT NOT NULL,        -- e.g. "metadata.user_plan", "params.model", "tag"
  condition_op TEXT NOT NULL,           -- "eq", "neq", "in", "startswith", "regex"
  condition_value TEXT NOT NULL,        -- e.g. "paid", "gpt-4", "eu_"
  target_model TEXT,                   -- override model_id if condition matches
  target_provider_id INTEGER,          -- override provider config id
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_provider_id) REFERENCES provider_configs(id) ON DELETE SET NULL
);

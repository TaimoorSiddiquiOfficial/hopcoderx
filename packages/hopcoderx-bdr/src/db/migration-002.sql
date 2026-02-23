-- migration-002: provider_configs, virtual_keys, mcp_servers tables + usage_logs columns + new settings
-- Run: bun x wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-002.sql

-- Provider configs (multi-provider routing)
CREATE TABLE IF NOT EXISTS provider_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  base_url TEXT,
  weight INTEGER DEFAULT 100,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Virtual keys (user-scoped API keys with restrictions)
CREATE TABLE IF NOT EXISTS virtual_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  provider_config_id INTEGER,
  allowed_models TEXT,
  monthly_limit_cents INTEGER,
  rate_limit_per_min INTEGER,
  user_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_config_id) REFERENCES provider_configs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vk_hash ON virtual_keys(key_hash);

-- MCP servers for the MCP proxy gateway
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  api_key_encrypted TEXT,
  allowed_tools TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add provider and attempt_count to usage_logs (ignore if already exists)
ALTER TABLE usage_logs ADD COLUMN provider TEXT;
ALTER TABLE usage_logs ADD COLUMN attempt_count INTEGER DEFAULT 1;

-- New settings for guardrails, retry, and caching
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('guardrail_enabled', '0'),
  ('guardrail_blocked_words', ''),
  ('guardrail_pii_mask', '1'),
  ('guardrail_injection_detect', '1'),
  ('retry_attempts', '2'),
  ('request_timeout_ms', '30000'),
  ('cache_enabled', '0'),
  ('cache_ttl_seconds', '300');

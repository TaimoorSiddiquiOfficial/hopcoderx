-- HopCoderX BDR Database Schema
-- Run: wrangler d1 execute hopcoderx-bdr --file src/db/schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,              -- NULL for OAuth/magic-link only users
  role TEXT DEFAULT 'user',        -- 'admin' or 'user'
  balance_cents INTEGER DEFAULT 0,
  monthly_limit_cents INTEGER DEFAULT 10000,
  auto_reload_enabled BOOLEAN DEFAULT 0,
  auto_reload_amount_cents INTEGER DEFAULT 2000,
  stripe_customer_id TEXT,
  suspended BOOLEAN DEFAULT 0,
  email_verified BOOLEAN DEFAULT 0,
  invited_by TEXT,                 -- user id of who invited this user
  auth_provider TEXT DEFAULT 'password',  -- 'password','google','github','magic_link'
  auth_provider_id TEXT,           -- OAuth subject / provider uid
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API Keys for HopCoderX CLI
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,        -- SHA256 hash of the key
  key_prefix TEXT,               -- First 6 chars for display
  name TEXT,                     -- User-defined name
  last_used DATETIME,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Usage logs
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  api_key_id INTEGER,            -- Which key was used
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  gateway_cache_hit BOOLEAN DEFAULT 0,
  response_time_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);

-- Models (curated list)
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,        -- 'openrouter', 'workers-ai'
  model_id TEXT NOT NULL,        -- e.g., 'openai/gpt-4o', '@cf/meta/llama-3.1-8b-instruct'
  name TEXT NOT NULL,
  description TEXT,
  context_length INTEGER,
  pricing_input_cents_per_m INTEGER NOT NULL,  -- per 1M tokens
  pricing_output_cents_per_m INTEGER NOT NULL,
  is_featured BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, model_id)
);
CREATE INDEX IF NOT EXISTS idx_models_featured ON models(is_featured, is_active);

-- Transactions (billing)
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'credit_add', 'usage_deduct', 'admin_adjust', 'refund', 'usage_payment'
  amount_cents INTEGER NOT NULL, -- positive for add, negative for deduct
  stripe_payment_id TEXT,        -- Stripe payment intent ID
  description TEXT,
  metadata TEXT,                 -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_time ON transactions(user_id, created_at DESC);

-- Settings (global configuration)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Invite tokens
CREATE TABLE IF NOT EXISTS invite_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,       -- admin user id
  email TEXT,                     -- pre-filled email, NULL = open invite
  used_by TEXT,                   -- user id who used it
  used_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invite_token ON invite_tokens(token);

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_verify_token ON email_verification_tokens(token);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_token ON password_reset_tokens(token);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('billing_enabled', '0'),
  ('markup_type', 'percentage'),
  ('markup_value', '0'),
  ('default_monthly_limit_cents', '10000'),
  ('openrouter_api_key', ''),
  ('stripe_secret_key', ''),
  ('stripe_webhook_secret', ''),
  ('stripe_publishable_key', ''),
  ('site_url', 'https://bdr.hopcoder.dev'),
  -- Auth & registration
  ('registration_mode', 'open'),         -- 'open', 'invite_only', 'disabled'
  ('required_email_domain', ''),         -- e.g., @company.com, empty = any
  ('email_verification_required', '0'),  -- 0 or 1
  ('auth_password', '1'),                -- enable password auth
  ('auth_magic_link', '0'),              -- enable magic link
  ('auth_google', '0'),                  -- enable Google OAuth
  ('auth_github', '0'),                  -- enable GitHub OAuth
  ('google_client_id', ''),
  ('google_client_secret', ''),
  ('github_client_id', ''),
  ('github_client_secret', ''),
  -- Email / SMTP
  ('smtp_host', ''),
  ('smtp_port', '587'),
  ('smtp_user', ''),
  ('smtp_pass', ''),
  ('smtp_from', 'noreply@example.com'),
  -- Routing & limits
  ('max_tokens_per_request', '0'),       -- 0 = unlimited
  ('rate_limit_per_min', '60'),          -- per API key
  ('cache_enabled', '0'),
  ('cache_ttl_seconds', '300'),
  -- Security
  ('ip_allowlist', ''),                  -- comma-sep CIDRs, empty = allow all
  ('request_logging_enabled', '1'),
  ('log_retention_days', '90'),
  -- Misc
  ('maintenance_mode', '0'),
  ('custom_system_prompt', '');

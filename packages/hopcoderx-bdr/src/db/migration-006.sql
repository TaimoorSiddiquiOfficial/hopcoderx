-- Migration 006: Agent Presets
-- Run local:  wrangler d1 execute hopcoderx-bdr --local  --file src/db/migration-006.sql
-- Run remote: wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-006.sql

-- --------------------------------------------------------------------------
-- agent_presets: reusable, named configurations that can be attached to any
-- API request either via the x-hopcoderx-agent header or via the dedicated
-- /v1/agents/:slug/chat/completions endpoint.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_presets (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  slug                TEXT     UNIQUE NOT NULL,         -- URL-safe ID: "coding-assistant"
  name                TEXT     NOT NULL,
  description         TEXT,

  -- ── Prompt ──────────────────────────────────────────────────────────────
  system_prompt       TEXT,                             -- injected system message
  system_prompt_mode  TEXT    DEFAULT 'prepend',        -- 'prepend' | 'replace' | 'append'

  -- ── Model & generation overrides (NULL = honour client's value) ──────────
  model               TEXT,                             -- force to this model_id
  temperature         REAL,
  max_tokens          INTEGER,
  top_p               REAL,
  frequency_penalty   REAL,
  presence_penalty    REAL,
  stop_sequences      TEXT,                             -- JSON string[]

  -- ── Tool calling ─────────────────────────────────────────────────────────
  tools               TEXT,                             -- JSON OpenAI-format tool[]
  tool_choice         TEXT,                             -- 'auto'|'none'|'required'|JSON obj

  -- ── MCP servers ──────────────────────────────────────────────────────────
  mcp_servers         TEXT,                             -- JSON [{name,url,apiKey?}]

  -- ── Fallback: if the preset model fails, retry with these in order ───────
  fallback_models     TEXT,                             -- JSON string[]

  -- ── Access control ───────────────────────────────────────────────────────
  -- NULL = any authenticated key/user may use this preset
  allowed_key_ids     TEXT,                             -- JSON number[] of api_key.id
  allowed_user_ids    TEXT,                             -- JSON string[] of user.id

  -- ── Categorisation & passthrough ─────────────────────────────────────────
  tags                TEXT,                             -- JSON string[] for filtering
  metadata            TEXT,                             -- arbitrary JSON passthrough to client

  -- ── State ────────────────────────────────────────────────────────────────
  is_active           BOOLEAN DEFAULT 1,
  is_public           BOOLEAN DEFAULT 0,               -- appear in GET /v1/agents
  sort_order          INTEGER DEFAULT 0,

  created_by          TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_presets_slug   ON agent_presets(slug, is_active);
CREATE INDEX IF NOT EXISTS idx_agent_presets_public ON agent_presets(is_public, is_active, sort_order);

-- --------------------------------------------------------------------------
-- Track which agent preset handled each request
-- --------------------------------------------------------------------------
ALTER TABLE usage_logs ADD COLUMN agent_id INTEGER REFERENCES agent_presets(id);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_logs(agent_id);

-- --------------------------------------------------------------------------
-- Seed two example presets so there is something to look at immediately
-- --------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_presets
  (slug, name, description, system_prompt, system_prompt_mode, is_active, is_public, sort_order)
VALUES
  (
    'assistant',
    'General Assistant',
    'Helpful, concise general-purpose assistant.',
    'You are a helpful, concise assistant. Always answer clearly and directly. Be brief unless depth is needed.',
    'replace',
    1, 1, 0
  ),
  (
    'coder',
    'Code Assistant',
    'Expert software engineer specialising in clean, idiomatic code.',
    'You are an expert software engineer. Write clean, idiomatic, well-commented code. Prefer functional patterns. Explain your reasoning briefly. When showing diffs use unified diff format.',
    'replace',
    1, 1, 10
  );

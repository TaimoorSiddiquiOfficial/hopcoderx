-- Migration 007: Cloudflare API token setting + model catalog sync support
-- Run local:  wrangler d1 execute hopcoderx-bdr --local  --file src/db/migration-007.sql
-- Run remote: wrangler d1 execute hopcoderx-bdr --remote --file src/db/migration-007.sql

-- API token used to fetch the Cloudflare Workers AI model catalog
-- Needs AI: Read permission at minimum
-- Generate at https://dash.cloudflare.com/profile/api-tokens
INSERT OR IGNORE INTO settings (key, value) VALUES ('cloudflare_api_token', '');

-- Track when catalog was last synced per provider
INSERT OR IGNORE INTO settings (key, value) VALUES ('workers_ai_catalog_synced_at', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('openrouter_catalog_synced_at', '');

-- Store imported-from source on models for display/grouping
-- D1 ALTER TABLE ADD COLUMN is idempotent (IF NOT EXISTS not supported, but will error gracefully)
ALTER TABLE models ADD COLUMN catalog_synced_at DATETIME DEFAULT NULL;

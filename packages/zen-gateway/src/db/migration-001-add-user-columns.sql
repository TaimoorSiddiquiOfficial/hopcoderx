-- Migration 001: Add columns to existing users table
-- Safe to run on existing DBs that predate the suspended/email_verified columns.
-- For FRESH databases, the main schema.sql already includes these columns.
ALTER TABLE users ADD COLUMN suspended BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN invited_by TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'password';
ALTER TABLE users ADD COLUMN auth_provider_id TEXT;

import { Database } from "bun:sqlite"
import { join } from "path"
import { randomUUID } from "crypto"

const DB_PATH = Bun.env.PANEL_DB_PATH ?? join(import.meta.dir, "../../data/panel.db")
// Ensure data dir exists
import { mkdirSync } from "fs"
mkdirSync(join(DB_PATH, ".."), { recursive: true })

const db = new Database(DB_PATH, { create: true })
db.run("PRAGMA journal_mode=WAL")
db.run("PRAGMA foreign_keys=ON")

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    github_id TEXT UNIQUE,
    github_login TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    plan TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    created_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    model TEXT,
    ts INTEGER NOT NULL
  )
`)
db.run(`CREATE INDEX IF NOT EXISTS usage_user_ts ON usage (user_id, ts)`)

db.run(`
  CREATE TABLE IF NOT EXISTS user_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL
  )
`)
db.run(`CREATE INDEX IF NOT EXISTS user_tokens_id ON user_tokens (id)`)

// Daily quota per plan (requests/day). -1 = unlimited.
export const PLAN_QUOTA: Record<string, number> = {
  free: 20,
  mini: 100,
  pro: 500,
  engineer: 2000,
  admin: -1,
}

export type User = {
  id: string
  email: string | null
  github_login: string | null
  avatar_url: string | null
  role: "admin" | "user"
  plan: "free" | "mini" | "pro" | "engineer"
  stripe_customer_id: string | null
  created_at: number
}

export type UserWithHash = User & { password_hash: string | null }

// --- Users ---

export function createUser(data: { email?: string; password_hash?: string; github_id?: string; github_login?: string; avatar_url?: string }) {
  const count = (db.query("SELECT COUNT(*) as c FROM users").get() as { c: number }).c
  const id = randomUUID()
  db.run(
    `INSERT INTO users (id, email, password_hash, github_id, github_login, avatar_url, role, plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'free', ?)`,
    [id, data.email ?? null, data.password_hash ?? null, data.github_id ?? null, data.github_login ?? null, data.avatar_url ?? null, count === 0 ? "admin" : "user", Date.now()],
  )
  return getUser(id)!
}

export function getUser(id: string) {
  return db.query("SELECT id, email, github_login, avatar_url, role, plan, stripe_customer_id, created_at FROM users WHERE id = ?").get(id) as User | null
}

export function getUserByEmail(email: string) {
  return db.query("SELECT * FROM users WHERE email = ?").get(email) as UserWithHash | null
}

export function getUserByGithub(github_id: string) {
  return db.query("SELECT id, email, github_login, avatar_url, role, plan, stripe_customer_id, created_at FROM users WHERE github_id = ?").get(github_id) as User | null
}

export function listUsers() {
  return db.query("SELECT id, email, github_login, avatar_url, role, plan, created_at FROM users ORDER BY created_at ASC").all() as User[]
}

export function updateUser(id: string, data: { plan?: string; role?: string }) {
  if (data.plan) db.run("UPDATE users SET plan = ? WHERE id = ?", [data.plan, id])
  if (data.role) db.run("UPDATE users SET role = ? WHERE id = ?", [data.role, id])
}

// --- Sessions ---

export function createSession(user_id: string) {
  const id = randomUUID()
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [id, user_id, Date.now() + 30 * 24 * 60 * 60 * 1000])
  return id
}

export function getSession(id: string) {
  return db
    .query(
      `SELECT u.id, u.email, u.github_login, u.avatar_url, u.role, u.plan, u.created_at
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(id, Date.now()) as User | null
}

export function deleteSession(id: string) {
  db.run("DELETE FROM sessions WHERE id = ?", [id])
}

// --- Gateway Settings ---

export function getSetting(key: string) {
  return (db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)?.value ?? null
}

export function setSetting(key: string, value: string) {
  db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [key, value, Date.now()])
}

export function listSettings() {
  return db.query("SELECT key, value FROM settings ORDER BY key ASC").all() as { key: string; value: string }[]
}

// --- API Keys ---

export function listApiKeys(user_id: string) {
  return db.query("SELECT id, provider, label, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at ASC").all(user_id) as { id: string; provider: string; label: string | null; created_at: number }[]
}

export function saveApiKey(user_id: string, provider: string, value: string, label?: string) {
  const id = randomUUID()
  db.run("INSERT INTO api_keys (id, provider, value, label, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, provider, value, label ?? null, user_id, Date.now()])
  return id
}

export function deleteApiKey(id: string, user_id: string) {
  db.run("DELETE FROM api_keys WHERE id = ? AND user_id = ?", [id, user_id])
}

// All provider keys (for building Portkey config at runtime)
export function getAllProviderKeys() {
  return db.query("SELECT provider, value FROM api_keys ORDER BY created_at ASC").all() as { provider: string; value: string }[]
}

// --- User API tokens (bdrk_ keys used in hopcoderx.json) ---

export function createUserToken(user_id: string, label?: string) {
  const id = `bdrk_${randomUUID().replace(/-/g, "")}`
  db.run("INSERT INTO user_tokens (id, user_id, label, created_at) VALUES (?, ?, ?, ?)", [id, user_id, label ?? null, Date.now()])
  return id
}

export function getUserByToken(token: string) {
  return db
    .query(
      `SELECT u.id, u.email, u.github_login, u.avatar_url, u.role, u.plan, u.created_at
       FROM user_tokens t JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`,
    )
    .get(token) as User | null
}

export function listUserTokens(user_id: string) {
  return db.query("SELECT id, label, created_at FROM user_tokens WHERE user_id = ? ORDER BY created_at ASC").all(user_id) as { id: string; label: string | null; created_at: number }[]
}

export function deleteUserToken(id: string, user_id: string) {
  db.run("DELETE FROM user_tokens WHERE id = ? AND user_id = ?", [id, user_id])
}

// --- Usage tracking ---

export function recordUsage(user_id: string, model: string | null) {
  db.run("INSERT INTO usage (id, user_id, model, ts) VALUES (?, ?, ?, ?)", [randomUUID(), user_id, model ?? null, Date.now()])
}

export function getUsageToday(user_id: string) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return (db.query("SELECT COUNT(*) as c FROM usage WHERE user_id = ? AND ts >= ?").get(user_id, start.getTime()) as { c: number }).c
}

export function getUsageMonth(user_id: string) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return (db.query("SELECT COUNT(*) as c FROM usage WHERE user_id = ? AND ts >= ?").get(user_id, start) as { c: number }).c
}

export function getAdminUsageStats() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const today = (db.query("SELECT COUNT(*) as c FROM usage WHERE ts >= ?").get(start.getTime()) as { c: number }).c
  const total = (db.query("SELECT COUNT(*) as c FROM usage").get() as { c: number }).c
  return { today, total }
}

export function hasUsers() {
  return (db.query("SELECT COUNT(*) as c FROM users").get() as { c: number }).c > 0
}

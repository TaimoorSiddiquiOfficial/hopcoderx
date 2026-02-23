#!/usr/bin/env bun
/**
 * sync-models.ts — HopCoderX BDR model sync
 *
 * Fetches active models from the gateway API and rewrites the `models`
 * block in hopcoderx.json so the CLI always reflects what the gateway serves.
 *
 * Usage (virtual key — Mode A via worker, recommended):
 *   HOPCODERX_API_KEY=<vk-...> bun .hopcoderx/sync-models.ts
 *
 * Usage (owner/admin — Mode B via CF AI Gateway token):
 *   CF_AIG_TOKEN=<cf-token> bun .hopcoderx/sync-models.ts
 *
 * Flags:
 *   --gateway=<url>   Override gateway base URL
 *   --all             Sync all active models (default: featured only)
 *   --dry-run         Print without writing
 */

import { resolve } from "path"

// ── Config ──────────────────────────────────────────────────────────────────

const GATEWAY = "https://hopcoderx-bdr.taimoorrehman-sid.workers.dev"
const CONFIG   = resolve(import.meta.dir, "hopcoderx.json")

let featuredOnly = true
let dryRun = false
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--gateway=")) process.env.BDR_GATEWAY_URL = arg.slice(10)
  if (arg.startsWith("--token="))   process.env.CF_AIG_TOKEN     = arg.slice(8)
  if (arg === "--all")              featuredOnly = false
  if (arg === "--dry-run")          dryRun = true
}

const base  = process.env.BDR_GATEWAY_URL ?? GATEWAY
const token = process.env.HOPCODERX_API_KEY ?? process.env.CF_AIG_TOKEN ?? ""

if (!token) {
  console.error("❌  No API key. Set HOPCODERX_API_KEY (virtual key) or CF_AIG_TOKEN.")
  process.exit(1)
}

// ── Fetch ───────────────────────────────────────────────────────────────────

const url = `${base}/v1/models${featuredOnly ? "?featured=1" : ""}`
console.log(`🔄  Fetching ${featuredOnly ? "featured" : "all"} models from ${url} …`)

const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
if (!res.ok) {
  const body = await res.text().catch(() => "")
  console.error(`❌  ${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  process.exit(1)
}

const { data: models = [] } = await res.json() as { data: any[] }
if (!models.length) {
  console.warn("⚠️  Gateway returned 0 models — hopcoderx.json not changed.")
  process.exit(0)
}
console.log(`✅  ${models.length} model(s): ${models.map((m: any) => m.id).join(", ")}`)

// ── Capability helpers ───────────────────────────────────────────────────────

// CF AI Gateway unified format uses google/ for Gemini (other providers match their name)
const PREFIX: Record<string, string> = {
  openai: "openai", anthropic: "anthropic",
  gemini: "google",  // CF AI Gateway unified convention
  "workers-ai": "workers-ai", openrouter: "openrouter",
}

function unifiedId(ownedBy: string, rawId: string): string {
  const prefix = PREFIX[ownedBy] ?? ownedBy
  if (rawId.startsWith(`${prefix}/`)) return rawId
  return `${prefix}/${rawId}`
}

function prov(id: string) {
  return id.split("/")[0]
}

function isReasoning(id: string) {
  return /\bo[1-9]\b|o3|o4|thinking|reasoning|r1/i.test(id)
}

function hasVision(id: string, p: string) {
  if (["openai", "anthropic", "gemini", "google"].includes(p)) return true
  return /vision|vl\b|pixtral|llava/i.test(id)
}

function hasTools(id: string, p: string) {
  if (["openai", "anthropic", "gemini", "google", "openrouter"].includes(p)) return true
  return /llama-3\.[123]|mistral|qwen|hermes/i.test(id)
}

function ctxLen(m: any, p: string): number {
  if (m.context_length) return m.context_length
  if (p === "anthropic") return 200000
  if (p === "gemini" || p === "google") return 1000000
  if (p === "openai") return 128000
  return 8192
}

function outLen(id: string, ctx: number): number {
  if (/gpt-4o|gpt-4\.5|claude-3-5|claude-sonnet-4|claude-opus-4/i.test(id)) return 16384
  if (/gemini-2/i.test(id)) return 8192
  return Math.min(ctx, 4096)
}

function releaseDate(m: any): string | undefined {
  if (m.created) return new Date(m.created * 1000).toISOString().slice(0, 10)
  const known: Record<string, string> = {
    "gpt-4o": "2024-05-13", "gpt-4o-mini": "2024-07-18",
    "o1": "2024-09-12", "o3": "2025-04-16",
    "claude-3-5-sonnet-20241022": "2024-10-22",
    "claude-sonnet-4-5": "2025-07-22", "claude-opus-4-5": "2025-07-22",
    "gemini-2.5-pro": "2025-03-25", "gemini-2.0-flash": "2025-01-21",
  }
  const short = (m.id as string).split("/").pop() ?? ""
  return known[short]
}

// ── Build models block ───────────────────────────────────────────────────────

const block: Record<string, any> = {}

for (const m of models) {
  // m.id = bare model_id (e.g. "gpt-4o", "@cf/meta/llama-3.1-8b-instruct")
  // m.owned_by = provider type (e.g. "openai", "workers-ai", "gemini")
  // Build the unified key: "openai/gpt-4o", "google/gemini-2.5-pro", etc.
  const id: string = unifiedId(m.owned_by ?? prov(m.id), m.id)
  const p   = prov(id)
  const ctx = ctxLen(m, p)
  const out = outLen(id, ctx)
  const date = releaseDate(m)

  const entry: Record<string, any> = {
    name:        m.name ?? id,
    attachment:  hasVision(id, p),
    reasoning:   isReasoning(id),
    temperature: !isReasoning(id),   // o1/o3 ignore temperature
    tool_call:   hasTools(id, p),
    limit:       { context: ctx, output: out },
    options:     {},
  }
  if (date) entry.release_date = date
  if (m.pricing?.prompt || m.pricing?.completion) {
    entry.cost = { input: m.pricing.prompt ?? 0, output: m.pricing.completion ?? 0 }
  }

  block[id] = entry
}

// ── Write ────────────────────────────────────────────────────────────────────

if (dryRun) {
  console.log("\n📋  Dry run — would write:\n")
  console.log(JSON.stringify({ "hopcoderx-bdr": { models: block } }, null, 2))
  process.exit(0)
}

const cfg = await Bun.file(CONFIG).json() as any
cfg.provider        ??= {}
cfg.provider["hopcoderx-bdr"] ??= {}
cfg.provider["hopcoderx-bdr"].models = block

await Bun.write(CONFIG, JSON.stringify(cfg, null, 2) + "\n")
console.log(`📝  Wrote ${Object.keys(block).length} model(s) to ${CONFIG}`)

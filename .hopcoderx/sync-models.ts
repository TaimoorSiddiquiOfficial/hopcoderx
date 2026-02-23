#!/usr/bin/env bun
/**
 * sync-models.ts
 * Fetches the featured model list from the HopCoderX BDR gateway API
 * and rewrites the models block in hopcoderx.json.
 *
 * Usage:
 *   bun G:\HopCoderX\.hopcoderx\sync-models.ts [--gateway=<url>]
 *
 * Requires CF_AIG_TOKEN env var (or --token=<key> arg).
 */

import { resolve } from "path"

const GATEWAY_URL = process.env.BDR_GATEWAY_URL ?? "https://hopcoderx-bdr.taimoorrehman-sid.workers.dev"
const TOKEN = process.env.CF_AIG_TOKEN ?? ""
const CONFIG_PATH = resolve(import.meta.dir, "hopcoderx.json")

// Parse CLI overrides
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--gateway=")) process.env.BDR_GATEWAY_URL = arg.slice("--gateway=".length)
  if (arg.startsWith("--token=")) process.env.CF_AIG_TOKEN = arg.slice("--token=".length)
}

const gatewayUrl = process.env.BDR_GATEWAY_URL ?? GATEWAY_URL
const apiToken = process.env.CF_AIG_TOKEN ?? TOKEN

if (!apiToken) {
  console.error("❌  CF_AIG_TOKEN not set. Run: CF_AIG_TOKEN=<key> bun sync-models.ts")
  process.exit(1)
}

console.log(`🔄  Fetching models from ${gatewayUrl}/v1/models?featured=1 …`)

const res = await fetch(`${gatewayUrl}/v1/models?featured=1`, {
  headers: { Authorization: `Bearer ${apiToken}` },
})

if (!res.ok) {
  const body = await res.text().catch(() => "")
  console.error(`❌  Gateway returned ${res.status}: ${body.slice(0, 200)}`)
  process.exit(1)
}

const data = await res.json() as { data?: any[] }
const models: any[] = data.data ?? []

if (!models.length) {
  console.warn("⚠️  No featured models returned — hopcoderx.json not updated.")
  process.exit(0)
}

console.log(`✅  Got ${models.length} model(s): ${models.map((m: any) => m.id).join(", ")}`)

// Build the models object for hopcoderx.json
const modelsEntry: Record<string, any> = {}

for (const m of models) {
  const id: string = m.id           // e.g. "openai/gpt-4o"
  const ctx = m.context_window as number ?? m.context_length as number ?? 128000
  const maxOut = m.max_completion_tokens as number ?? 4096

  modelsEntry[id] = {
    name: m.name ?? id,
    release_date: m.created ? new Date((m.created as number) * 1000).toISOString().slice(0, 10) : undefined,
    attachment: !!(m.vision ?? false),
    reasoning: !!(m.reasoning ?? false),
    temperature: true,
    tool_call: !!(m.function_calling ?? true),
    limit: { context: ctx, output: maxOut },
    options: {},
  }
  // Strip undefined keys
  for (const k of Object.keys(modelsEntry[id]))
    if (modelsEntry[id][k] === undefined) delete modelsEntry[id][k]
}

// Read + patch hopcoderx.json
const cfg = await Bun.file(CONFIG_PATH).json() as any
cfg.provider["hopcoderx-bdr"] ??= {}
cfg.provider["hopcoderx-bdr"].models = modelsEntry

await Bun.write(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n")
console.log(`📝  Updated ${CONFIG_PATH} with ${Object.keys(modelsEntry).length} model(s).`)

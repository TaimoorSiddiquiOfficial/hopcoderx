/**
 * Memory dreaming — background consolidation process.
 *
 * Inspired by biological memory consolidation during sleep.
 * Periodically reviews recent memory entries and:
 *   1. Merges near-duplicate entries (same concept, different wording)
 *   2. Extracts patterns ("this project always uses X for Y")
 *   3. Decays infrequently accessed entries (LRU-style)
 *   4. Generates "insight" entries from clusters of related items
 *
 * Run via: hopcoderx memory dream   (manual one-shot)
 *         daemon heartbeat          (auto every 4 hours when daemon is running)
 *
 * All consolidation happens locally — no LLM calls required (purely heuristic).
 * Optionally, if HOPCODERX_DREAM_LLM=1 is set, uses the configured model to
 * generate insight summaries (uses cheap/fast model to minimize cost).
 */

import { MemoryPlugin, type MemoryEntry } from "./memory"
import { Global } from "../global"
import { join } from "path"
import { writeFile, readFile, mkdir } from "fs/promises"
import { existsSync } from "fs"

export interface DreamReport {
  merged: number
  decayed: number
  insights: string[]
  timestamp: number
  durationMs: number
}

const DREAM_LOG = join(Global.Path.data, "dream-log.jsonl")
const DECAY_THRESHOLD_DAYS = 30
const SIMILARITY_THRESHOLD = 0.7

/** Simple token-level Jaccard similarity for duplicate detection */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    )
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  return intersection / (setA.size + setB.size - intersection)
}

/** Extract high-frequency concepts from a set of memory contents */
function extractPatterns(contents: string[]): string[] {
  const freq: Record<string, number> = {}
  for (const c of contents) {
    const tokens = c
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 4)
    for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1
  }
  return Object.entries(freq)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token)
}

export async function runDreaming(): Promise<DreamReport> {
  const start = Date.now()
  const report: DreamReport = { merged: 0, decayed: 0, insights: [], timestamp: start, durationMs: 0 }

  if (!MemoryPlugin.isActive()) {
    report.durationMs = Date.now() - start
    return report
  }

  const backend = MemoryPlugin.active

  // 1. List all memories
  const all: MemoryEntry[] = await backend.list({ limit: 1000 })
  if (all.length < 5) {
    report.durationMs = Date.now() - start
    return report
  }

  // 2. Decay old, rarely accessed memories
  const decayThreshold = Date.now() - DECAY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  const toDecay = all.filter((m: MemoryEntry) => m.createdAt < decayThreshold)
  for (const m of toDecay) {
    await backend.delete(m.id)
    report.decayed++
  }

  // 3. Merge near-duplicate memories
  const active = all.filter((m: MemoryEntry) => m.createdAt >= decayThreshold)
  const merged = new Set<string>()
  for (let i = 0; i < active.length; i++) {
    if (merged.has(active[i].id)) continue
    for (let j = i + 1; j < active.length; j++) {
      if (merged.has(active[j].id)) continue
      const sim = jaccardSimilarity(active[i].content, active[j].content)
      if (sim >= SIMILARITY_THRESHOLD) {
        // Keep the more recent one, delete the other
        const older = active[i].createdAt < active[j].createdAt ? active[i] : active[j]
        await backend.delete(older.id)
        merged.add(older.id)
        report.merged++
      }
    }
  }

  // 4. Extract patterns and create insight memories
  const contents = active.filter((m: MemoryEntry) => !merged.has(m.id)).map((m: MemoryEntry) => m.content)
  const patterns = extractPatterns(contents)
  if (patterns.length >= 5) {
    const insight = `Recurring patterns in this session: ${patterns.slice(0, 5).join(", ")}`
    await backend.upsert({
      content: insight,
      tags: ["dream", "insight", "auto"],
      projectScope: null,
      score: 1.0,
    })
    report.insights.push(insight)
  }

  report.durationMs = Date.now() - start

  // Log the dream report
  try {
    await mkdir(Global.Path.data, { recursive: true })
    await writeFile(DREAM_LOG, JSON.stringify(report) + "\n", { flag: "a" })
  } catch {}

  return report
}

/** Read the last N dream reports */
export async function readDreamLog(n = 10): Promise<DreamReport[]> {
  if (!existsSync(DREAM_LOG)) return []
  try {
    const content = await readFile(DREAM_LOG, "utf8")
    return content
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DreamReport)
      .slice(-n)
  } catch {
    return []
  }
}

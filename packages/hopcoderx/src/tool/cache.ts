/**
 * Cache tool — in-session result caching with TTL and invalidation.
 *
 * Lets the agent cache expensive operation results (search results,
 * analysis outputs, computed data) and retrieve them within the session.
 * Optionally invalidates based on file modification time.
 */

import z from "zod"
import { Tool } from "./tool"
import { stat } from "fs/promises"

interface CacheEntry {
  value: string
  storedAt: number
  ttlMs: number
  watchFiles?: string[]
  tags?: string[]
}

// In-process cache — lives for the session duration
const SESSION_CACHE = new Map<string, CacheEntry>()
const MAX_ENTRIES = 500

type Meta = Record<string, unknown>

async function isExpired(entry: CacheEntry): Promise<boolean> {
  if (Date.now() - entry.storedAt > entry.ttlMs) return true
  if (entry.watchFiles?.length) {
    for (const f of entry.watchFiles) {
      try {
        const s = await stat(f)
        if (s.mtimeMs > entry.storedAt) return true
      } catch {
        // File deleted — invalidate
        return true
      }
    }
  }
  return false
}

const OPERATIONS = ["get", "set", "invalidate", "list", "clear"] as const

export const CacheTool = Tool.define("cache", {
  description:
    "In-session result cache. Store expensive computation results with a TTL and retrieve them later. Supports file-based invalidation (auto-expires when watched files change) and tag-based bulk invalidation. Useful for caching search results, analysis outputs, or any slow operation within a session.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe(
      "get: retrieve cached value | set: store a value | invalidate: delete by key or tag | list: show all cache entries | clear: delete all entries",
    ),
    key: z.string().optional().describe("Cache key (unique identifier)"),
    value: z.string().optional().describe("Value to store (for set operation)"),
    ttl_seconds: z.number().optional().default(300).describe("Time-to-live in seconds (default 300 = 5 minutes)"),
    watch_files: z.array(z.string()).optional().describe("File paths that, when modified, auto-invalidate this cache entry"),
    tags: z.array(z.string()).optional().describe("Tags for bulk invalidation via invalidate operation"),
    tag: z.string().optional().describe("Tag to invalidate all entries with (for invalidate operation)"),
  }),
  async execute(params, _ctx) {
    const op = params.operation

    if (op === "get") {
      if (!params.key) return { title: "cache get", output: "Error: `key` is required", metadata: { hit: false } as Meta }
      const entry = SESSION_CACHE.get(params.key)
      if (!entry || await isExpired(entry)) {
        if (entry) SESSION_CACHE.delete(params.key)
        return { title: "cache get — miss", output: `Cache miss: ${params.key}`, metadata: { hit: false, key: params.key } as Meta }
      }
      const age = Math.floor((Date.now() - entry.storedAt) / 1000)
      return {
        title: `cache get — hit (${age}s old)`,
        output: entry.value,
        metadata: { hit: true, key: params.key, ageSeconds: age } as Meta,
      }
    }

    if (op === "set") {
      if (!params.key) return { title: "cache set", output: "Error: `key` is required", metadata: {} as Meta }
      if (params.value === undefined) return { title: "cache set", output: "Error: `value` is required", metadata: {} as Meta }
      const entry: CacheEntry = {
        value: params.value,
        storedAt: Date.now(),
        ttlMs: (params.ttl_seconds ?? 300) * 1000,
        watchFiles: params.watch_files,
        tags: params.tags,
      }
      SESSION_CACHE.set(params.key, entry)
      // Evict oldest entry if over the limit
      if (SESSION_CACHE.size > MAX_ENTRIES) {
        SESSION_CACHE.delete(SESSION_CACHE.keys().next().value!)
      }
      return {
        title: `cache set — ${params.key}`,
        output: `✅ Cached '${params.key}' for ${params.ttl_seconds ?? 300}s${params.watch_files?.length ? ` (watches ${params.watch_files.length} file(s))` : ""}`,
        metadata: { key: params.key, ttlSeconds: params.ttl_seconds ?? 300 } as Meta,
      }
    }

    if (op === "invalidate") {
      if (params.tag) {
        let count = 0
        for (const [k, v] of SESSION_CACHE) {
          if (v.tags?.includes(params.tag)) { SESSION_CACHE.delete(k); count++ }
        }
        return { title: `cache invalidate tag:${params.tag}`, output: `Deleted ${count} entries with tag '${params.tag}'`, metadata: { deleted: count } as Meta }
      }
      if (params.key) {
        const existed = SESSION_CACHE.delete(params.key)
        return { title: `cache invalidate`, output: existed ? `✅ Deleted: ${params.key}` : `Key not found: ${params.key}`, metadata: { deleted: existed ? 1 : 0 } as Meta }
      }
      return { title: "cache invalidate", output: "Error: provide `key` or `tag`", metadata: {} as Meta }
    }

    if (op === "list") {
      if (SESSION_CACHE.size === 0) return { title: "cache list", output: "Cache is empty.", metadata: { count: 0 } as Meta }
      const lines: string[] = [`Cache entries (${SESSION_CACHE.size} total):\n`]
      for (const [k, v] of SESSION_CACHE) {
        const expired = await isExpired(v) ? " [expired]" : ""
        const age = Math.floor((Date.now() - v.storedAt) / 1000)
        const ttlLeft = Math.max(0, Math.floor((v.storedAt + v.ttlMs - Date.now()) / 1000))
        const preview = v.value.slice(0, 60).replace(/\n/g, "↵")
        lines.push(`  ${k}${expired}  age=${age}s ttl_left=${ttlLeft}s  "${preview}${v.value.length > 60 ? "…" : ""}"`)
        if (v.tags?.length) lines.push(`    tags: ${v.tags.join(", ")}`)
      }
      return { title: `cache list (${SESSION_CACHE.size})`, output: lines.join("\n"), metadata: { count: SESSION_CACHE.size } as Meta }
    }

    if (op === "clear") {
      const count = SESSION_CACHE.size
      SESSION_CACHE.clear()
      return { title: "cache clear", output: `✅ Cleared ${count} cache entries`, metadata: { deleted: count } as Meta }
    }

    return { title: "cache", output: "Unknown operation", metadata: {} as Meta }
  },
})

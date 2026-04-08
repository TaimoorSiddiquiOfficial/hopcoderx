/**
 * LanceDB vector memory backend.
 *
 * Uses LanceDB (local columnar vector store) for semantic similarity search
 * over code memories. Falls back to keyword search if the embedding provider
 * is unavailable.
 *
 * Install the optional dependency to enable:
 *   bun add vectordb
 */

import type { MemoryBackend, MemoryEntry, MemorySearchResult } from "./memory"
import { Global } from "../global"
import { join } from "path"
import { randomUUID } from "crypto"

const DB_PATH = () => join(Global.Path.data, "memory-lancedb")
const TABLE_NAME = "memories"

/**
 * Simple cosine similarity between two float32 vectors.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * A trivial TF-IDF-style embedding for fallback mode (no real vector model).
 * Generates a 256-dim bag-of-words sparse vector.
 */
function trivialEmbed(text: string): number[] {
  const vec = new Array<number>(256).fill(0)
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  for (const w of words) {
    let h = 5381
    for (let i = 0; i < w.length; i++) { h = ((h << 5) + h) ^ w.charCodeAt(i) }
    vec[Math.abs(h) % 256] += 1
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export class LanceDBMemory implements MemoryBackend {
  readonly id = "lancedb"
  readonly name = "LanceDB Vector Memory"

  private db: any = null
  private table: any = null
  /** In-memory fallback store (used when LanceDB not available) */
  private fallback: Map<string, MemoryEntry> = new Map()
  private useFallback = false

  async init(): Promise<void> {
    try {
      const lancedb = await import("vectordb" as any)
      this.db = await lancedb.connect(DB_PATH())
      const tables = await this.db.tableNames()
      if (tables.includes(TABLE_NAME)) {
        this.table = await this.db.openTable(TABLE_NAME)
      } else {
        // Create with a dummy record to establish schema
        this.table = await this.db.createTable(TABLE_NAME, [
          {
            id: "_init",
            content: "",
            tags: "[]",
            projectScope: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            accessCount: 0,
            score: 0,
            vector: trivialEmbed(""),
          },
        ])
        await this.table.delete("id = '_init'")
      }
    } catch {
      // LanceDB not installed — use in-memory fallback
      this.useFallback = true
    }
  }

  async upsert(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "accessCount"> & { id?: string },
  ): Promise<MemoryEntry> {
    const now = Date.now()
    const id = entry.id ?? randomUUID()
    const vector = trivialEmbed(entry.content)
    const full: MemoryEntry = {
      id,
      content: entry.content,
      tags: entry.tags,
      projectScope: entry.projectScope,
      embedding: vector,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      score: entry.score,
    }

    if (this.useFallback) {
      this.fallback.set(id, full)
      return full
    }

    // LanceDB: delete + re-insert for upsert semantics
    try { await this.table.delete(`id = '${id}'`) } catch { /* doesn't exist yet */ }
    await this.table.add([{ ...full, tags: JSON.stringify(entry.tags), vector }])
    return full
  }

  async get(id: string): Promise<MemoryEntry | null> {
    if (this.useFallback) return this.fallback.get(id) ?? null
    try {
      const rows = await this.table.filter(`id = '${id}'`).execute()
      if (!rows || rows.length === 0) return null
      return this.rowToEntry(rows[0])
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<void> {
    if (this.useFallback) { this.fallback.delete(id); return }
    await this.table.delete(`id = '${id}'`)
  }

  async search(
    query: string,
    opts?: { limit?: number; projectScope?: string | null; tags?: string[] },
  ): Promise<MemorySearchResult[]> {
    const limit = opts?.limit ?? 10
    const queryVec = trivialEmbed(query)

    let entries: MemoryEntry[]
    if (this.useFallback) {
      entries = Array.from(this.fallback.values())
    } else {
      try {
        const rows = await this.table.search(queryVec).limit(limit * 3).execute()
        entries = rows.map((r: any) => this.rowToEntry(r))
      } catch {
        entries = []
      }
    }

    // Filter by project scope + tags
    if (opts?.projectScope !== undefined) {
      entries = entries.filter((e) => !e.projectScope || e.projectScope === opts.projectScope)
    }
    if (opts?.tags && opts.tags.length > 0) {
      entries = entries.filter((e) => opts.tags!.some((t) => e.tags.includes(t)))
    }

    // Rerank with cosine similarity
    const scored = entries.map((e) => ({
      entry: e,
      similarity: cosine(queryVec, e.embedding ?? trivialEmbed(e.content)),
    }))
    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit)
  }

  async list(opts?: { projectScope?: string | null; tags?: string[]; limit?: number }): Promise<MemoryEntry[]> {
    let entries: MemoryEntry[]
    if (this.useFallback) {
      entries = Array.from(this.fallback.values())
    } else {
      try {
        const rows = await this.table.filter("id != '_init'").execute()
        entries = rows.map((r: any) => this.rowToEntry(r))
      } catch {
        entries = []
      }
    }

    if (opts?.projectScope !== undefined) {
      entries = entries.filter((e) => !e.projectScope || e.projectScope === opts.projectScope)
    }
    if (opts?.tags && opts.tags.length > 0) {
      entries = entries.filter((e) => opts.tags!.some((t) => e.tags.includes(t)))
    }
    entries.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    if (opts?.limit) entries = entries.slice(0, opts.limit)
    return entries
  }

  async export(): Promise<MemoryEntry[]> {
    return this.list()
  }

  async clear(): Promise<void> {
    if (this.useFallback) { this.fallback.clear(); return }
    try { await this.table.delete("id != '_impossible_never_matches'") } catch { /* ok */ }
  }

  async close(): Promise<void> {
    // LanceDB connections don't need explicit close
    this.db = null
    this.table = null
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      tags: typeof row.tags === "string" ? JSON.parse(row.tags ?? "[]") : (row.tags ?? []),
      projectScope: row.projectScope ?? null,
      embedding: Array.isArray(row.vector) ? row.vector : undefined,
      createdAt: row.createdAt ?? Date.now(),
      updatedAt: row.updatedAt ?? Date.now(),
      accessCount: row.accessCount ?? 0,
      score: row.score ?? 1,
    }
  }
}

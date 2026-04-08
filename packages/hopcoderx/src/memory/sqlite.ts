/**
 * SQLite memory backend — fast local structured memory.
 *
 * Uses Bun's built-in SQLite (bun:sqlite) for zero-dependency storage.
 * Provides simple keyword + tag search without embeddings.
 */

import { join } from "path"
import type { MemoryBackend, MemoryEntry, MemorySearchResult } from "./memory"
import { Global } from "../global"

function dbPath(): string {
  return join(Global.Path.data, "memory.db")
}

export class SQLiteMemory implements MemoryBackend {
  readonly id = "sqlite"
  readonly name = "SQLite Memory"
  private db: any = null

  async init(): Promise<void> {
    const { Database } = await import("bun:sqlite")
    this.db = new Database(dbPath(), { create: true })
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        tags        TEXT NOT NULL DEFAULT '[]',
        projectScope TEXT,
        createdAt   INTEGER NOT NULL,
        updatedAt   INTEGER NOT NULL,
        accessCount INTEGER NOT NULL DEFAULT 0,
        score       REAL NOT NULL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(projectScope);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updatedAt DESC);
    `)
  }

  private ensureDb() {
    if (!this.db) throw new Error("SQLiteMemory not initialized. Call init() first.")
  }

  async upsert(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "accessCount"> & { id?: string },
  ): Promise<MemoryEntry> {
    this.ensureDb()
    const now = Date.now()
    const id = entry.id ?? crypto.randomUUID()
    const existing = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as any
    if (existing) {
      this.db.run(
        "UPDATE memories SET content=?, tags=?, projectScope=?, updatedAt=?, score=? WHERE id=?",
        [entry.content, JSON.stringify(entry.tags), entry.projectScope ?? null, now, entry.score, id],
      )
    } else {
      this.db.run(
        "INSERT INTO memories (id,content,tags,projectScope,createdAt,updatedAt,accessCount,score) VALUES (?,?,?,?,?,?,0,?)",
        [id, entry.content, JSON.stringify(entry.tags), entry.projectScope ?? null, now, now, entry.score],
      )
    }
    return this.get(id) as Promise<MemoryEntry>
  }

  async get(id: string): Promise<MemoryEntry | null> {
    this.ensureDb()
    const row = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as any
    if (!row) return null
    this.db.run("UPDATE memories SET accessCount = accessCount + 1 WHERE id = ?", [id])
    return this.rowToEntry(row)
  }

  async delete(id: string): Promise<void> {
    this.ensureDb()
    this.db.run("DELETE FROM memories WHERE id = ?", [id])
  }

  async search(
    query: string,
    opts?: { limit?: number; projectScope?: string | null; tags?: string[] },
  ): Promise<MemorySearchResult[]> {
    this.ensureDb()
    const limit = opts?.limit ?? 10
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

    let sql = "SELECT * FROM memories WHERE 1=1"
    const params: any[] = []

    if (opts?.projectScope !== undefined) {
      sql += " AND (projectScope = ? OR projectScope IS NULL)"
      params.push(opts.projectScope)
    }
    if (opts?.tags && opts.tags.length > 0) {
      const tagClauses = opts.tags.map(() => "tags LIKE ?").join(" OR ")
      sql += ` AND (${tagClauses})`
      params.push(...opts.tags.map((t) => `%"${t}"%`))
    }

    sql += " ORDER BY score DESC, updatedAt DESC LIMIT ?"
    params.push(limit * 5) // over-fetch, then re-rank

    const rows = this.db.query(sql).all(...params) as any[]
    const entries = rows.map(this.rowToEntry)

    // Simple BM25-like scoring: count matching terms
    const scored = entries.map((e) => {
      const text = e.content.toLowerCase()
      const matches = terms.filter((t) => text.includes(t)).length
      const similarity = terms.length > 0 ? matches / terms.length : 0.5
      return { entry: e, similarity }
    })

    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit)
  }

  async list(opts?: { projectScope?: string | null; tags?: string[]; limit?: number }): Promise<MemoryEntry[]> {
    this.ensureDb()
    let sql = "SELECT * FROM memories WHERE 1=1"
    const params: any[] = []

    if (opts?.projectScope !== undefined) {
      sql += " AND (projectScope = ? OR projectScope IS NULL)"
      params.push(opts.projectScope)
    }
    if (opts?.tags && opts.tags.length > 0) {
      const tagClauses = opts.tags.map(() => "tags LIKE ?").join(" OR ")
      sql += ` AND (${tagClauses})`
      params.push(...opts.tags.map((t) => `%"${t}"%`))
    }
    sql += " ORDER BY score DESC, updatedAt DESC"
    if (opts?.limit) { sql += " LIMIT ?"; params.push(opts.limit) }

    return (this.db.query(sql).all(...params) as any[]).map(this.rowToEntry)
  }

  async export(): Promise<MemoryEntry[]> {
    return this.list()
  }

  async clear(): Promise<void> {
    this.ensureDb()
    this.db.run("DELETE FROM memories")
  }

  async close(): Promise<void> {
    this.db?.close?.()
    this.db = null
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      tags: JSON.parse(row.tags ?? "[]"),
      projectScope: row.projectScope ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessCount: row.accessCount,
      score: row.score,
    }
  }
}

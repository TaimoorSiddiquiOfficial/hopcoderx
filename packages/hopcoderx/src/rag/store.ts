import { Database as BunDatabase } from "bun:sqlite"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { createHash } from "crypto"
import path from "path"
import { mkdirSync } from "fs"

const log = Log.create({ service: "rag.store" })

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

export namespace Store {
  const client = lazy(() => {
    const dir = path.join(Global.Path.data, "index")
    mkdirSync(dir, { recursive: true })
    const filepath = path.join(dir, `${hash(Instance.directory)}.db`)

    log.info("opening", { path: filepath })
    const sqlite = new BunDatabase(filepath, { create: true })
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS chunk_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath TEXT NOT NULL,
        content TEXT NOT NULL,
        symbol_name TEXT NOT NULL DEFAULT '',
        symbol_type TEXT NOT NULL DEFAULT '',
        start_line INTEGER NOT NULL DEFAULT 0,
        end_line INTEGER NOT NULL DEFAULT 0
      )
    `)

    sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        filepath, content, symbol_name, symbol_type,
        content=chunk_data, content_rowid=id,
        tokenize='porter unicode61'
      )
    `)

    sqlite.run(`
      CREATE TRIGGER IF NOT EXISTS chunk_ai AFTER INSERT ON chunk_data BEGIN
        INSERT INTO chunks(rowid, filepath, content, symbol_name, symbol_type)
        VALUES (new.id, new.filepath, new.content, new.symbol_name, new.symbol_type);
      END
    `)
    sqlite.run(`
      CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON chunk_data BEGIN
        INSERT INTO chunks(chunks, rowid, filepath, content, symbol_name, symbol_type)
        VALUES ('delete', old.id, old.filepath, old.content, old.symbol_name, old.symbol_type);
      END
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        parent TEXT,
        signature TEXT
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_filepath TEXT NOT NULL,
        source_symbol TEXT NOT NULL,
        target_symbol TEXT NOT NULL,
        kind TEXT NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS files (
        filepath TEXT PRIMARY KEY,
        mtime REAL NOT NULL,
        size INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_chunk_filepath ON chunk_data(filepath)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_sym_filepath ON symbols(filepath)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(name)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_edge_target ON edges(target_symbol)`)

    return sqlite
  })

  export interface SearchResult {
    filepath: string
    content: string
    symbol_name: string
    symbol_type: string
    rank: number
    start_line: number
    end_line: number
  }

  export function search(query: string, limit = 20): SearchResult[] {
    const words = query.replace(/['"(){}[\]:]/g, "").split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const escaped = words.map((w) => `"${w}"`).join(" OR ")
    return client().prepare(`
      SELECT c.filepath, c.content, c.symbol_name, c.symbol_type,
             chunks.rank, c.start_line, c.end_line
      FROM chunks
      JOIN chunk_data c ON c.id = chunks.rowid
      WHERE chunks MATCH ?
      ORDER BY chunks.rank
      LIMIT ?
    `).all(escaped, limit) as SearchResult[]
  }

  export function findSymbols(query: string, kind?: string, limit = 20) {
    if (kind) {
      return client().prepare(`
        SELECT filepath, name, kind, start_line, end_line, parent, signature
        FROM symbols WHERE name LIKE ? AND kind = ?
        ORDER BY filepath, start_line LIMIT ?
      `).all(`%${query}%`, kind, limit) as {
        filepath: string; name: string; kind: string
        start_line: number; end_line: number; parent: string | null; signature: string | null
      }[]
    }
    return client().prepare(`
      SELECT filepath, name, kind, start_line, end_line, parent, signature
      FROM symbols WHERE name LIKE ?
      ORDER BY filepath, start_line LIMIT ?
    `).all(`%${query}%`, limit) as {
      filepath: string; name: string; kind: string
      start_line: number; end_line: number; parent: string | null; signature: string | null
    }[]
  }

  export function references(symbol: string) {
    return client().prepare(`
      SELECT source_filepath, source_symbol, target_symbol, kind
      FROM edges WHERE target_symbol = ? OR source_symbol = ?
    `).all(symbol, symbol) as {
      source_filepath: string; source_symbol: string; target_symbol: string; kind: string
    }[]
  }

  export function file(filepath: string) {
    return client().prepare(
      `SELECT filepath, mtime, size, indexed_at FROM files WHERE filepath = ?`,
    ).get(filepath) as { filepath: string; mtime: number; size: number; indexed_at: number } | undefined
  }

  export function insertChunks(items: {
    filepath: string; content: string; symbol_name: string
    symbol_type: string; start_line: number; end_line: number
  }[]) {
    const stmt = client().prepare(
      `INSERT INTO chunk_data(filepath, content, symbol_name, symbol_type, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    client().transaction((rows: typeof items) => {
      for (const c of rows) stmt.run(c.filepath, c.content, c.symbol_name, c.symbol_type, c.start_line, c.end_line)
    })(items)
  }

  export function insertSymbols(items: {
    filepath: string; name: string; kind: string
    start_line: number; end_line: number; parent?: string; signature?: string
  }[]) {
    const stmt = client().prepare(
      `INSERT INTO symbols(filepath, name, kind, start_line, end_line, parent, signature) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    client().transaction((rows: typeof items) => {
      for (const s of rows) stmt.run(s.filepath, s.name, s.kind, s.start_line, s.end_line, s.parent ?? null, s.signature ?? null)
    })(items)
  }

  export function insertEdges(items: {
    source_filepath: string; source_symbol: string; target_symbol: string; kind: string
  }[]) {
    const stmt = client().prepare(
      `INSERT INTO edges(source_filepath, source_symbol, target_symbol, kind) VALUES (?, ?, ?, ?)`,
    )
    client().transaction((rows: typeof items) => {
      for (const e of rows) stmt.run(e.source_filepath, e.source_symbol, e.target_symbol, e.kind)
    })(items)
  }

  export function upsertFile(filepath: string, mtime: number, size: number) {
    client().prepare(
      `INSERT OR REPLACE INTO files(filepath, mtime, size, indexed_at) VALUES (?, ?, ?, ?)`,
    ).run(filepath, mtime, size, Date.now())
  }

  export function removeFile(filepath: string) {
    client().prepare(`DELETE FROM chunk_data WHERE filepath = ?`).run(filepath)
    client().prepare(`DELETE FROM symbols WHERE filepath = ?`).run(filepath)
    client().prepare(`DELETE FROM edges WHERE source_filepath = ?`).run(filepath)
    client().prepare(`DELETE FROM files WHERE filepath = ?`).run(filepath)
  }

  export function clear() {
    client().run(`DELETE FROM chunk_data`)
    client().run(`DELETE FROM symbols`)
    client().run(`DELETE FROM edges`)
    client().run(`DELETE FROM files`)
  }

  export function stats() {
    const c = client().prepare(`SELECT count(*) as count FROM chunk_data`).get() as { count: number }
    const s = client().prepare(`SELECT count(*) as count FROM symbols`).get() as { count: number }
    const f = client().prepare(`SELECT count(*) as count FROM files`).get() as { count: number }
    return { chunks: c.count, symbols: s.count, files: f.count }
  }
}

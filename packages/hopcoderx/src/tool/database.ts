/**
 * SQLite database tool.
 *
 * Execute SQL queries, inspect schema, and run migrations against a SQLite database.
 * Also provides basic connection testing for PostgreSQL/MySQL via connection strings.
 */

import z from "zod"
import { Tool } from "./tool"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../project/instance"

type Meta = Record<string, unknown>

async function runSqlite(dbPath: string, sql: string): Promise<{ rows: Record<string, unknown>[]; rowsAffected?: number }> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(dbPath, { readonly: false })
  try {
    const stmt = db.prepare(sql)
    const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql)
    if (isSelect) {
      const rows = stmt.all() as Record<string, unknown>[]
      return { rows }
    } else {
      const result = stmt.run() as { changes: number; lastInsertRowid: number }
      return { rows: [], rowsAffected: result.changes }
    }
  } finally {
    db.close()
  }
}

async function runSqliteMigration(dbPath: string, statements: string[]): Promise<string[]> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(dbPath, { readonly: false })
  const results: string[] = []
  try {
    db.exec("BEGIN")
    for (const stmt of statements) {
      const prepared = db.prepare(stmt)
      const result = prepared.run() as { changes: number }
      results.push(`✅ ${stmt.slice(0, 60)}${stmt.length > 60 ? "…" : ""}${result.changes !== undefined ? ` (${result.changes} rows affected)` : ""}`)
    }
    db.exec("COMMIT")
  } catch (e: any) {
    db.exec("ROLLBACK")
    throw e
  } finally {
    db.close()
  }
  return results
}

async function listTables(dbPath: string): Promise<string[]> {
  const { rows } = await runSqlite(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return rows.map((r) => r["name"] as string)
}

async function getSchema(dbPath: string): Promise<string> {
  const { rows } = await runSqlite(dbPath, "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  if (!rows.length) return "No tables found."
  return rows
    .map((r) => `-- ${r["name"]}\n${r["sql"]};`)
    .join("\n\n")
}

function formatTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(no rows)"
  const keys = Object.keys(rows[0]!)
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "null").length)))
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join(" │ ")
  const sep = widths.map((w) => "─".repeat(w)).join("─┼─")
  const dataRows = rows.map((r) => keys.map((k, i) => String(r[k] ?? "null").padEnd(widths[i]!)).join(" │ "))
  return [header, sep, ...dataRows].join("\n")
}

const OPERATIONS = ["query", "schema", "tables", "migrate", "export"] as const

export const DatabaseTool = Tool.define("database", {
  description:
    "Execute SQL queries against SQLite databases, inspect schema, list tables, run migrations (multiple statements), and export table data as CSV. Specify the database file path relative to the project root.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe(
      "query: run SQL | schema: show CREATE TABLE statements | tables: list all tables | migrate: run SQL migration script | export: export table as CSV",
    ),
    database: z.string().describe("Path to SQLite database file (relative to project root, e.g. 'data/app.db' or ':memory:')"),
    sql: z.string().optional().describe("SQL statement(s) to execute (for query/migrate operations)"),
    table: z.string().optional().describe("Table name for export operation"),
    limit: z.number().optional().default(100).describe("Max rows to return for query results (default 100)"),
  }),
  async execute(params, _ctx) {
    const base = Instance.worktree || Instance.directory
    const dbPath= params.database === ":memory:" ? ":memory:" : (
      path.isAbsolute(params.database) ? params.database : path.join(base, params.database)
    )

    if (dbPath !== ":memory:" && !existsSync(dbPath) && params.operation !== "migrate") {
      return { title: "database", output: `Database file not found: ${params.database}`, metadata: {} as Meta }
    }

    const op = params.operation

    if (op === "tables") {
      const names = await listTables(dbPath)
      return {
        title: "database tables",
        output: names.length ? names.map((n) => `  ${n}`).join("\n") : "No tables found.",
        metadata: { count: names.length } as Meta,
      }
    }

    if (op === "schema") {
      const schema = await getSchema(dbPath)
      return { title: "database schema", output: schema, metadata: {} as Meta }
    }

    if (op === "query") {
      if (!params.sql) return { title: "database query", output: "Error: `sql` is required", metadata: {} as Meta }
      const sql = /\bLIMIT\b/i.test(params.sql) ? params.sql : `${params.sql.trimEnd().replace(/;$/, "")} LIMIT ${params.limit ?? 100}`
      const { rows, rowsAffected } = await runSqlite(dbPath, sql)
      if (rowsAffected !== undefined) {
        return { title: "database query", output: `${rowsAffected} row(s) affected`, metadata: { rowsAffected } as Meta }
      }
      const output = `${rows.length} row(s):\n\n${formatTable(rows)}`
      return { title: `database query (${rows.length} rows)`, output, metadata: { rows: rows.length } as Meta }
    }

    if (op === "migrate") {
      if (!params.sql) return { title: "database migrate", output: "Error: `sql` is required", metadata: {} as Meta }
      const statements = params.sql.split(";").map((s) => s.trim()).filter(Boolean)
      try {
        const results = await runSqliteMigration(dbPath, statements)
        return {
          title: `database migrate (${statements.length} statements)`,
          output: results.join("\n"),
          metadata: { statements: statements.length } as Meta,
        }
      } catch (e: any) {
        return {
          title: "database migrate — error (rolled back)",
          output: `Migration failed and was rolled back.\n${e?.message ?? String(e)}`,
          metadata: { error: true } as Meta,
        }
      }
    }

    if (op === "export") {
      if (!params.table) return { title: "database export", output: "Error: `table` is required for export", metadata: {} as Meta }
      const validTables = await listTables(dbPath)
      if (!validTables.includes(params.table)) {
        return {
          title: "database export",
          output: `Table '${params.table}' not found. Available tables: ${validTables.join(", ") || "(none)"}`,
          metadata: {} as Meta,
        }
      }
      const { rows } = await runSqlite(dbPath, `SELECT * FROM "${params.table}" LIMIT ${params.limit ?? 1000}`)
      if (!rows.length) return { title: "database export", output: "No rows to export.", metadata: {} as Meta }
      const keys = Object.keys(rows[0]!)
      const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n")
      return {
        title: `database export — ${params.table}`,
        output: csv,
        metadata: { rows: rows.length, columns: keys.length } as Meta,
      }
    }

    return { title: "database", output: "Unknown operation", metadata: {} as Meta }
  },
})

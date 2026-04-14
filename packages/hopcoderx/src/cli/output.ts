/**
 * Enhanced output formats for HopCoderX CLI.
 *
 * Supports: table, json, yaml, csv, markdown, html
 *
 * Usage:
 *   hopcoderx status --format table
 *   hopcoderx mcp list --format json
 *   hopcoderx memory list --format yaml
 */

import yaml from "yaml"

export type OutputFormat = "table" | "json" | "yaml" | "csv" | "markdown" | "html"

export const OUTPUT_FORMATS: OutputFormat[] = ["table", "json", "yaml", "csv", "markdown", "html"]

export interface OutputOptions {
  format?: OutputFormat
  headers?: boolean
  style?: "compact" | "expanded"
}

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const MAGENTA = "\x1b[35m"
const WHITE = "\x1b[97m"

// ─── Format Output ────────────────────────────────────────────────────────────

export function formatOutput<T extends Record<string, unknown>>(
  data: T | T[],
  options: OutputOptions = {},
): string {
  const format = options.format ?? "table"
  const items = Array.isArray(data) ? data : [data]

  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2)
    case "yaml":
      return yaml.stringify(data)
    case "csv":
      return toCSV(items as Record<string, unknown>[], options.headers !== false)
    case "markdown":
      return toMarkdown(items as Record<string, unknown>[], options.headers !== false)
    case "html":
      return toHTML(items as Record<string, unknown>[], options.headers !== false)
    case "table":
    default:
      return toTable(items as Record<string, unknown>[], options)
  }
}

// ─── Table Format ─────────────────────────────────────────────────────────────

export function toTable<T extends Record<string, unknown>>(
  items: T[],
  options: OutputOptions = {},
): string {
  if (items.length === 0) return "No data"

  const keys = Object.keys(items[0]).filter((k) => k !== "_internal")
  const compact = options.style === "compact"

  // Calculate column widths
  const widths = keys.map((key) => {
    const headerLen = key.length
    const maxContentLen = Math.max(...items.map((item) => String(item[key] ?? "").length))
    return Math.max(headerLen, maxContentLen, compact ? 10 : 20)
  })

  // Build table
  const lines: string[] = []

  // Header
  if (options.headers !== false) {
    const header = keys
      .map((key, i) => CYAN + BOLD + key.padEnd(widths[i]) + RESET)
      .join(" │ ")
    lines.push(header)
    lines.push(DIM + "─".repeat(lines[0].replace(/\x1b\[\d+m/g, "").length) + RESET)
  }

  // Rows
  for (const item of items) {
    const row = keys
      .map((key, i) => {
        const value = String(item[key] ?? "")
        const truncated = value.length > widths[i] ? value.slice(0, widths[i] - 3) + "..." : value
        return truncated.padEnd(widths[i])
      })
      .join(" │ ")
    lines.push(row)
  }

  return lines.join("\n")
}

// ─── CSV Format ───────────────────────────────────────────────────────────────

export function toCSV<T extends Record<string, unknown>>(
  items: T[],
  includeHeaders = true,
): string {
  if (items.length === 0) return ""

  const keys = Object.keys(items[0])
  const lines: string[] = []

  // Escape CSV field
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    const str = String(val)
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Headers
  if (includeHeaders) {
    lines.push(keys.map(escape).join(","))
  }

  // Rows
  for (const item of items) {
    lines.push(keys.map((k) => escape(item[k])).join(","))
  }

  return lines.join("\n")
}

// ─── Markdown Format ──────────────────────────────────────────────────────────

export function toMarkdown<T extends Record<string, unknown>>(
  items: T[],
  includeHeaders = true,
): string {
  if (items.length === 0) return "_No data_"

  const keys = Object.keys(items[0])

  const lines: string[] = []

  // Headers
  if (includeHeaders) {
    lines.push("| " + keys.join(" | ") + " |")
    lines.push("| " + keys.map(() => "---").join(" | ") + " |")
  }

  // Rows
  for (const item of items) {
    const row = keys.map((k) => {
      const val = item[k]
      if (val === null || val === undefined) return ""
      const str = String(val)
      // Escape pipe characters
      return str.replace(/\|/g, "\\|")
    }).join(" | ")
    lines.push("| " + row + " |")
  }

  return lines.join("\n")
}

// ─── HTML Format ──────────────────────────────────────────────────────────────

export function toHTML<T extends Record<string, unknown>>(
  items: T[],
  includeHeaders = true,
): string {
  if (items.length === 0) return "<p><em>No data</em></p>"

  const keys = Object.keys(items[0])

  const lines: string[] = [
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; font-family: sans-serif;">',
  ]

  // Headers
  if (includeHeaders) {
    lines.push("  <thead>")
    lines.push("    <tr>")
    for (const key of keys) {
      lines.push(`      <th style="background: #f0f0f0; font-weight: bold;">${escapeHTML(String(key))}</th>`)
    }
    lines.push("    </tr>")
    lines.push("  </thead>")
  }

  // Body
  lines.push("  <tbody>")
  for (const item of items) {
    lines.push("    <tr>")
    for (const key of keys) {
      const val = item[key]
      const display = val === null || val === undefined ? "" : String(val)
      lines.push(`      <td>${escapeHTML(display)}</td>`)
    }
    lines.push("    </tr>")
  }
  lines.push("  </tbody>")
  lines.push("</table>")

  return lines.join("\n")
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ─── Format Option Helper ─────────────────────────────────────────────────────

export function withFormatOption<T extends Record<string, unknown> = Record<string, unknown>>(
  yargs: any,
  defaultFormat: OutputFormat = "table",
) {
  return yargs.option("format", {
    type: "string",
    choices: OUTPUT_FORMATS,
    default: defaultFormat,
    describe: "Output format",
  })
}

// ─── Colored Status Helpers ───────────────────────────────────────────────────

export const Color = {
  success: (s: string) => GREEN + s + RESET,
  warning: (s: string) => YELLOW + s + RESET,
  error: (s: string) => RED + s + RESET,
  info: (s: string) => CYAN + s + RESET,
  dim: (s: string) => DIM + s + RESET,
  bold: (s: string) => BOLD + s + RESET,
  muted: (s: string) => DIM + s + RESET,
}

export const Icon = {
  success: "✓",
  warning: "⚠",
  error: "✗",
  info: "ℹ",
  pending: "⏳",
  running: "🔄",
  done: "✅",
  failed: "❌",
}

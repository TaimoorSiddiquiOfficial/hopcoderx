/**
 * Code review tool — automated diff-aware analysis.
 *
 * Reviews staged changes or specific files for security issues (OWASP patterns),
 * performance anti-patterns, and common code quality issues.
 * Returns structured findings with severity and line references.
 */

import z from "zod"
import { Tool } from "./tool"
import { execFile } from "child_process"
import { promisify } from "util"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../project/instance"

const execFileAsync = promisify(execFile)

type Meta = Record<string, unknown>

interface Finding{
  severity: "critical" | "high" | "medium" | "low" | "info"
  category: string
  message: string
  file?: string
  line?: number
}

const SECURITY_PATTERNS: Array<{ pattern: RegExp; message: string; severity: Finding["severity"]; category: string }> = [
  // SQL injection
  { pattern: /`SELECT.+\$\{|query\s*\+\s*['"`]|query\s*=\s*.*\+\s*\w+/i, message: "Potential SQL injection: string concatenation in query", severity: "critical", category: "SQL Injection" },
  // XSS
  { pattern: /innerHTML\s*=\s*[^'"`][^;]+;|document\.write\s*\(/i, message: "Potential XSS: unsanitized DOM assignment or document.write", severity: "high", category: "XSS" },
  // Path traversal
  { pattern: /\.\.\//, message: "Path traversal pattern (../) detected — validate user input", severity: "high", category: "Path Traversal" },
  // Hardcoded secrets
  { pattern: /(?:password|secret|api.?key|token)\s*[:=]\s*['"`][^'"`]{8,}/i, message: "Possible hardcoded secret or credential", severity: "critical", category: "Hardcoded Secret" },
  // Command injection
  { pattern: /exec\s*\(\s*[`'"`].*\$\{|child_process\.exec\s*\(\s*\w+\s*\+/i, message: "Potential command injection: dynamic exec() argument", severity: "critical", category: "Command Injection" },
  // eval
  { pattern: /\beval\s*\(/i, message: "eval() usage — dangerous if input is user-controlled", severity: "high", category: "Code Injection" },
  // Weak crypto
  { pattern: /createHash\s*\(\s*['"`]md5['"`]\)|createHash\s*\(\s*['"`]sha1['"`]\)/i, message: "Weak hash algorithm (MD5/SHA1) — use SHA-256 or stronger", severity: "medium", category: "Weak Cryptography" },
  // Console.log with secrets
  { pattern: /console\.\w+\s*\([^)]*(?:password|secret|token|key)[^)]*\)/i, message: "Possible secret logged to console", severity: "medium", category: "Secret Exposure" },
]

const PERF_PATTERNS: Array<{ pattern: RegExp; message: string; category: string }> = [
  { pattern: /for\s*\([^)]+\)\s*\{[^}]*await\s+/s, message: "await inside a for loop — consider Promise.all() for parallelism", category: "Performance" },
  { pattern: /\.forEach\s*\([^)]+async\s*\(/i, message: "async forEach() — use for...of or Promise.all() instead", category: "Performance" },
  { pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/i, message: "JSON.parse(JSON.stringify()) deep clone — use structuredClone() in modern JS", category: "Performance" },
  { pattern: /new Array\s*\(\d{4,}\)/i, message: "Large Array constructor — consider typed arrays for numeric data", category: "Performance" },
]

function reviewContent(content: string, filePath?: string): Finding[] {
  const findings: Finding[] = []
  const lines = content.split("\n")

  for (const { pattern, message, severity, category } of SECURITY_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (pattern.test(line)) {
        findings.push({ severity, category, message, file: filePath, line: i + 1 })
        break // one finding per pattern per file to avoid spam
      }
    }
  }

  for (const { pattern, message, category } of PERF_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ severity: "medium", category, message, file: filePath })
    }
  }

  // Check for TODOs/FIXMEs
  for (let i = 0; i < lines.length; i++) {
    if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(lines[i]!)) {
      const snippet = lines[i]!.trim().slice(0, 80)
      findings.push({ severity: "info", category: "Technical Debt", message: `${snippet}`, file: filePath, line: i + 1 })
    }
  }

  return findings
}

async function getGitDiff(cwd: string, staged: boolean): Promise<string> {
  const args = staged ? ["diff", "--cached", "--unified=3"] : ["diff", "HEAD", "--unified=3"]
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 }).catch(() => ({ stdout: "" }))
  return stdout
}

function parseDiffFiles(diff: string): Array<{ file: string; content: string }> {
  const files: Array<{ file: string; content: string }> = []
  const chunks = diff.split(/^diff --git /m).filter(Boolean)
  for (const chunk of chunks) {
    const fileMatch = /^a\/(.+?) b\/(.+?)$/m.exec(chunk)
    const file = fileMatch?.[2] ?? "unknown"
    const addedLines = chunk
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n")
    files.push({ file, content: addedLines })
  }
  return files
}

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "✅ No issues found."

  const bySeverity: Record<string, Finding[]> = {}
  for (const f of findings) {
    ;(bySeverity[f.severity] ??= []).push(f)
  }

  const order: Finding["severity"][] = ["critical", "high", "medium", "low", "info"]
  const icons: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" }
  const lines: string[] = []

  for (const sev of order) {
    const group = bySeverity[sev]
    if (!group?.length) continue
    lines.push(`\n${icons[sev]} **${sev.toUpperCase()}** (${group.length})`)
    for (const f of group) {
      const loc = [f.file, f.line ? `line ${f.line}` : ""].filter(Boolean).join(":")
      lines.push(`  • [${f.category}] ${f.message}${loc ? `  — ${loc}` : ""}`)
    }
  }

  return lines.join("\n")
}

export const ReviewTool = Tool.define("review", {
  description:
    "Automated code review that analyzes git diff (staged or HEAD) or specific files for security vulnerabilities (OWASP Top 10 patterns), performance anti-patterns, and technical debt. Returns findings grouped by severity: critical/high/medium/low/info.",
  parameters: z.object({
    mode: z
      .enum(["staged", "diff", "files"])
      .default("diff")
      .describe("staged: review staged changes | diff: review HEAD diff | files: review specific files"),
    files: z.array(z.string()).optional().describe("File paths to review (for mode=files)"),
    include_info: z.boolean().optional().default(true).describe("Include info-level findings like TODOs (default true)"),
  }),
  async execute(params, _ctx) {
    const cwd = Instance.worktree || Instance.directory
    let allFindings: Finding[] = []
    let context = ""

    if (params.mode === "files" && params.files?.length) {
      for (const f of params.files) {
        const full = path.isAbsolute(f) ? f : path.join(cwd, f)
        if (!existsSync(full)) continue
        const content = await readFile(full, "utf8")
        allFindings.push(...reviewContent(content, path.relative(cwd, full)))
      }
      context = `Reviewing ${params.files.length} file(s)`
    } else {
      const staged = params.mode === "staged"
      const diff = await getGitDiff(cwd, staged)
      if (!diff) {
        return {
          title: "review",
          output: `No changes found in ${staged ? "staged" : "HEAD"} diff.`,
          metadata: { findings: 0 } as Meta,
        }
      }
      const diffFiles = parseDiffFiles(diff)
      for (const { file, content } of diffFiles) {
        allFindings.push(...reviewContent(content, file))
      }
      context = `Reviewing ${staged ? "staged" : "HEAD"} diff (${diffFiles.length} file(s) changed)`
    }

    if (!params.include_info) {
      allFindings = allFindings.filter((f) => f.severity !== "info")
    }

    const critical = allFindings.filter((f) => f.severity === "critical").length
    const high = allFindings.filter((f) => f.severity === "high").length
    const title = allFindings.length === 0 ? "review — clean" : `review — ${critical} critical, ${high} high, ${allFindings.length} total`

    return {
      title,
      output: `${context}\n${formatFindings(allFindings)}`,
      metadata: {
        total: allFindings.length,
        critical,
        high,
        medium: allFindings.filter((f) => f.severity === "medium").length,
      } as Meta,
    }
  },
})

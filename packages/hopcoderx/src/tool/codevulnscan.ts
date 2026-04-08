import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"
import { $ } from "bun"
import { readdirSync, statSync } from "fs"

const log = Log.create({ service: "codevulnscan" })

const DESCRIPTION = `Scan code and dependencies for security vulnerabilities.

Capabilities:
- OSV-Scanner: checks package-lock.json/bun.lockb/go.sum/requirements.txt against the OSV advisory database
- Semgrep: static analysis for common vulnerability patterns (injection, XSS, path traversal, etc.)
- Secret detection: scans for accidentally committed credentials/API keys/tokens
- SAST patterns: checks for eval(), prototype pollution, unsafe regex, etc.

Returns a structured report with severity levels, CVE IDs, and remediation advice.
The agent should then apply the suggested fixes or file issues for manual review.`

type Meta = Record<string, string | number | boolean | undefined>

const parameters = z.object({
  target: z
    .string()
    .optional()
    .describe("Directory or file to scan (defaults to project root)"),
  mode: z
    .enum(["deps", "sast", "secrets", "all"])
    .default("all")
    .describe("Scan mode: deps=dependencies only, sast=code patterns, secrets=credential leaks, all=everything"),
  format: z.enum(["text", "json", "sarif"]).default("text").describe("Output format"),
  deep: z.boolean().default(false).describe("Enable deep scanning (slower, more rules)"),
})

export const CodeVulnScanTool = Tool.define<typeof parameters, Meta>("codevulnscan", {
  description: DESCRIPTION,
  parameters,
  async execute({ target, mode, format, deep }, ctx) {
    const dir = target
      ? path.isAbsolute(target)
        ? target
        : path.join(Instance.directory, target)
      : Instance.directory

    const exists = await Filesystem.exists(dir)
    if (!exists) {
      return {
        title: "codevulnscan: path not found",
        metadata: {} as Meta,
        output: `Error: "${dir}" does not exist.`,
      }
    }

    const results: Record<string, any[]> = { deps: [], sast: [], secrets: [] }
    const errors: string[] = []

    // --- Dependency scan (OSV-Scanner) ---
    if (mode === "deps" || mode === "all") {
      log.info("running osv-scanner", { dir })
      const r = await $`osv-scanner --json ${dir}`.quiet().nothrow()
      if (r.exitCode === 0 || r.exitCode === 1) {
        try {
          const data = JSON.parse(r.stdout.toString())
          for (const result of data?.results ?? []) {
            for (const pkg of result.packages ?? []) {
              for (const v of pkg.vulnerabilities ?? []) {
                results.deps.push({
                  id: v.id,
                  summary: v.summary ?? v.details?.slice(0, 120) ?? "",
                  severity: v.database_specific?.severity ?? "UNKNOWN",
                  package: pkg.package?.name,
                  version: pkg.package?.version,
                  fixed: v.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed ?? "unknown",
                })
              }
            }
          }
        } catch {
          errors.push("OSV-Scanner: failed to parse output")
        }
      } else if (r.exitCode === 127 || r.exitCode === null) {
        errors.push("OSV-Scanner not installed. Install: go install github.com/google/osv-scanner/cmd/osv-scanner@latest")
      }
    }

    // --- SAST scan (Semgrep) ---
    if (mode === "sast" || mode === "all") {
      log.info("running semgrep", { dir, deep })
      const config = deep ? "p/default" : "p/javascript p/typescript p/secrets"
      const r = await $`semgrep --config ${config} --json --quiet ${dir}`.quiet().nothrow()
      if (r.exitCode === 0 || r.exitCode === 1) {
        try {
          const data = JSON.parse(r.stdout.toString())
          for (const finding of data?.results ?? []) {
            results.sast.push({
              rule: finding.check_id,
              severity: finding.extra?.severity ?? "INFO",
              file: path.relative(dir, finding.path),
              line: finding.start?.line,
              message: finding.extra?.message ?? "",
              fix: finding.extra?.fix ?? null,
            })
          }
        } catch {
          errors.push("Semgrep: failed to parse output")
        }
      } else if (r.exitCode === 127 || r.exitCode === null) {
        errors.push("Semgrep not installed. Install: pip install semgrep  or  brew install semgrep")
      }
    }

    // --- Secret detection (built-in patterns) ---
    if (mode === "secrets" || mode === "all") {
      log.info("running secret scan", { dir })
      const secretHits = await scanSecretsInDirectory(dir)
      results.secrets.push(...secretHits)
    }

    // Build output
    const allFindings = [...results.deps, ...results.sast, ...results.secrets]

    if (format === "json") {
      return {
        title: `codevulnscan: ${path.basename(dir)} (${allFindings.length} findings)`,
        metadata: {
          depsCount: results.deps.length,
          sastCount: results.sast.length,
          secretsCount: results.secrets.length,
          total: allFindings.length,
        } as Meta,
        output: JSON.stringify({ results, errors }, null, 2),
      }
    }

    const lines: string[] = [
      `## Security Scan Results for \`${path.relative(Instance.directory, dir) || "."}\``,
      "",
    ]

    if (errors.length > 0) {
      lines.push("### ⚠️ Scanner Issues", ...errors.map((e) => `- ${e}`), "")
    }

    if (results.deps.length > 0) {
      lines.push(`### 🔒 Dependency Vulnerabilities (${results.deps.length})`, "")
      for (const v of results.deps.slice(0, 20)) {
        lines.push(`**[${v.severity}] ${v.id}** — ${v.package}@${v.version}`)
        lines.push(`  ${v.summary}`)
        if (v.fixed !== "unknown") lines.push(`  → Fixed in: ${v.fixed}`)
        lines.push("")
      }
    } else if (mode === "deps" || mode === "all") {
      lines.push("### ✅ Dependencies: No known vulnerabilities", "")
    }

    if (results.sast.length > 0) {
      lines.push(`### 🔍 SAST Findings (${results.sast.length})`, "")
      for (const f of results.sast.slice(0, 20)) {
        lines.push(`**[${f.severity}] ${f.rule}** — ${f.file}:${f.line}`)
        lines.push(`  ${f.message}`)
        if (f.fix) lines.push(`  → Fix: ${f.fix}`)
        lines.push("")
      }
    } else if (mode === "sast" || mode === "all") {
      lines.push("### ✅ SAST: No vulnerabilities found", "")
    }

    if (results.secrets.length > 0) {
      lines.push(`### 🔑 Secret Leaks (${results.secrets.length})`, "")
      for (const s of results.secrets) {
        lines.push(`**[CRITICAL]** ${s.file}:${s.line} — ${s.pattern}`)
        lines.push(`  → Rotate this credential immediately and remove from code`)
        lines.push("")
      }
    } else if (mode === "secrets" || mode === "all") {
      lines.push("### ✅ Secrets: No credentials found in code", "")
    }

    if (allFindings.length === 0 && errors.length === 0) {
      lines.push("### ✅ No security issues found!")
    } else if (allFindings.length > 0) {
      lines.push("---")
      lines.push(`**Total: ${allFindings.length} findings** — review and address before deployment.`)
      lines.push("")
      lines.push("### Agent Instructions")
      lines.push("For each CRITICAL or HIGH finding:")
      lines.push("1. Review the affected file/package")
      lines.push("2. Apply the suggested fix or upgrade the dependency")
      lines.push("3. Re-run codevulnscan to verify the fix")
    }

    return {
      title: `codevulnscan: ${allFindings.length} finding(s) in ${path.basename(dir)}`,
      metadata: {
        depsCount: results.deps.length,
        sastCount: results.sast.length,
        secretsCount: results.secrets.length,
        total: allFindings.length,
        hasErrors: errors.length > 0,
      } as Meta,
      output: lines.join("\n"),
    }
  },
})

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OpenAI API Key", pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "GitHub PAT", pattern: /ghp_[a-zA-Z0-9]{36}/g },
  { name: "GitHub OAuth", pattern: /gho_[a-zA-Z0-9]{36}/g },
  { name: "GitLab PAT", pattern: /glpat-[a-zA-Z0-9\-_]{20}/g },
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "Stripe Secret Key", pattern: /sk_live_[a-zA-Z0-9]{24,}/g },
  { name: "Anthropic API Key", pattern: /sk-ant-api[0-9A-Za-z\-_]{20,}/g },
  { name: "Private Key Block", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Hardcoded Password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{6,}["']/gi },
]

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "build", "coverage", ".next", "out"])

async function scanSecretsInDirectory(dir: string): Promise<Array<{ file: string; line: number; pattern: string }>> {
  const hits: Array<{ file: string; line: number; pattern: string }> = []

  function walkSync(current: string): void {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry)
      if (SKIP_DIRS.has(entry)) continue

      let isDir = false
      try {
        isDir = statSync(fullPath).isDirectory()
      } catch {
        continue
      }

      if (isDir) {
        walkSync(fullPath)
      } else {
        const ext = path.extname(entry)
        if (![".ts", ".js", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".env", ".sh", ".py", ".go", ".rb"].includes(ext))
          continue
        if (entry.endsWith(".min.js") || entry.endsWith(".min.css")) continue

        let content: string
        try {
          content = require("fs").readFileSync(fullPath, "utf8")
        } catch {
          continue
        }
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          for (const { name, pattern } of SECRET_PATTERNS) {
            pattern.lastIndex = 0
            if (pattern.test(lines[i]!)) {
              hits.push({ file: path.relative(dir, fullPath), line: i + 1, pattern: name })
              break
            }
          }
        }
      }
    }
  }

  walkSync(dir)
  return hits
}

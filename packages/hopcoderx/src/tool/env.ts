/**
 * .env file management tool.
 *
 * Read, write, generate templates, and detect leaked secrets in .env files.
 * Supports .env, .env.local, .env.production, .env.example etc.
 */

import z from "zod"
import { Tool } from "./tool"
import { readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../project/instance"

type Meta = Record<string, unknown>

// Common secret patterns — never expose values matching these
const SECRET_PATTERNS = [
  /^(sk|pk|rk|ak)[-_][a-zA-Z0-9]{16,}/,   // API keys like sk-xxx
  /^ghp_[a-zA-Z0-9]{36}/,                   // GitHub PAT
  /^xox[bpoa]-[0-9A-Za-z-]{24,}/,           // Slack tokens
  /^AKIA[0-9A-Z]{16}/,                       // AWS Access Key ID
  /^[a-zA-Z0-9+/]{40,}={0,2}$/,             // Base64 secret (40+ chars)
  /^[0-9a-f]{32,}$/,                         // Hex secret (32+ chars)
  /^postgres(?:ql)?:\/\/[^:]+:[^@]+@/i,     // DB connection with password
  /^mysql:\/\/[^:]+:[^@]+@/i,
  /^mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/i,
]

const SECRET_KEY_PATTERNS = [
  /secret/i, /password/i, /passwd/i, /private.?key/i,
  /api.?key/i, /access.?token/i, /auth.?token/i, /db.?pass/i,
]

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function serializeEnv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => {
      const needsQuote = v.includes(" ") || v.includes("#") || v.includes("$")
      return `${k}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`
    })
    .join("\n")
}

function detectSecrets(vars: Record<string, string>): string[] {
  const issues: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue
    const keyLooksSecret = SECRET_KEY_PATTERNS.some((p) => p.test(key))
    const valueLooksSecret = SECRET_PATTERNS.some((p) => p.test(value))
    if (keyLooksSecret && value.length > 8) {
      issues.push(`${key} — key name suggests a secret (value hidden)`)
    } else if (valueLooksSecret) {
      issues.push(`${key} — value matches a known secret pattern`)
    }
  }
  return issues
}

const OPERATIONS = ["read", "write", "set", "unset", "template", "scan", "diff"] as const

export const EnvTool = Tool.define("env", {
  description:
    "Manage .env files: read variables, write/update values, generate .env.example templates with values masked, scan for leaked secrets, and diff two env files. Works with .env, .env.local, .env.production etc.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe(
      "read: list all vars | write: set multiple vars atomically | set: set one var | unset: remove a var | template: generate .env.example | scan: detect secret leaks | diff: compare two env files",
    ),
    file: z.string().optional().default(".env").describe("Target .env file path (relative or absolute, default: .env)"),
    key: z.string().optional().describe("Variable key for set/unset operations"),
    value: z.string().optional().describe("Value for set operation"),
    vars: z.record(z.string(), z.string()).optional().describe("Multiple key-value pairs for write operation"),
    compare_file: z.string().optional().describe("Second file for diff operation"),
    show_values: z.boolean().optional().default(false).describe("Show actual values in read output (default: false for security)"),
  }),
  async execute(params, _ctx) {
    const base = Instance.worktree || Instance.directory
    const filePath = path.isAbsolute(params.file ?? ".env")
      ? (params.file ?? ".env")
      : path.join(base, params.file ?? ".env")

    const op = params.operation

    if (op === "diff") {
      const file2 = params.compare_file
        ? (path.isAbsolute(params.compare_file) ? params.compare_file : path.join(base, params.compare_file))
        : path.join(base, ".env.example")

      const [c1, c2] = await Promise.all([
        readFile(filePath, "utf8").catch(() => ""),
        readFile(file2, "utf8").catch(() => ""),
      ])
      const vars1 = parseEnv(c1)
      const vars2 = parseEnv(c2)
      const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)])
      const lines: string[] = [`Diff: ${path.basename(filePath)} vs ${path.basename(file2)}`, ""]
      for (const k of [...allKeys].sort()) {
        if (k in vars1 && k in vars2) lines.push(`  ${k}`)
        else if (k in vars1) lines.push(`+ ${k}  (only in ${path.basename(filePath)})`)
        else lines.push(`- ${k}  (only in ${path.basename(file2)})`)
      }
      return { title: "env diff", output: lines.join("\n"), metadata: {} as Meta }
    }

    if (op === "template") {
      const content = await readFile(filePath, "utf8").catch(() => "")
      const vars = parseEnv(content)
      const lines: string[] = [`# Generated from ${path.basename(filePath)}`, ""]
      for (const [k, v] of Object.entries(vars)) {
        const placeholder = v ? "your_value_here" : ""
        lines.push(`${k}=${placeholder}`)
      }
      const outPath = filePath.replace(/\.env[^/]*$/, ".env.example")
      await writeFile(outPath, lines.join("\n") + "\n", "utf8")
      return { title: "env template", output: `Generated ${path.relative(base, outPath)}\n\n${lines.join("\n")}`, metadata: {} as Meta }
    }

    if (op === "scan") {
      const content = existsSync(filePath) ? await readFile(filePath, "utf8") : ""
      const vars = parseEnv(content)
      const issues = detectSecrets(vars)
      if (issues.length === 0) {
        return { title: "env scan", output: `✅ No obvious secrets detected in ${path.basename(filePath)}`, metadata: { issues: 0 } as Meta }
      }
      return {
        title: `env scan — ${issues.length} issue(s)`,
        output: `⚠️ Potential secrets in ${path.basename(filePath)}:\n${issues.map((i) => `  • ${i}`).join("\n")}\n\nMake sure this file is in .gitignore!`,
        metadata: { issues: issues.length } as Meta,
      }
    }

    if (op === "read") {
      const content = existsSync(filePath) ? await readFile(filePath, "utf8") : ""
      const vars = parseEnv(content)
      if (Object.keys(vars).length === 0) {
        return { title: "env read", output: `${path.basename(filePath)} is empty or does not exist.`, metadata: {} as Meta }
      }
      const lines = Object.entries(vars).map(([k, v]) => {
        const val = params.show_values ? v : (v ? "***" : "(empty)")
        return `  ${k}=${val}`
      })
      return {
        title: `env read (${Object.keys(vars).length} vars)`,
        output: `${path.basename(filePath)}:\n${lines.join("\n")}`,
        metadata: { count: Object.keys(vars).length } as Meta,
      }
    }

    // Mutating operations
    const content = existsSync(filePath) ? await readFile(filePath, "utf8") : ""
    const vars = parseEnv(content)

    if (op === "set") {
      if (!params.key) return { title: "env set", output: "Error: `key` is required", metadata: {} as Meta }
      vars[params.key] = params.value ?? ""
    } else if (op === "unset") {
      if (!params.key) return { title: "env unset", output: "Error: `key` is required", metadata: {} as Meta }
      delete vars[params.key]
    } else if (op === "write") {
      Object.assign(vars, params.vars ?? {})
    }

    // Preserve existing file structure for comments + ordering, or write fresh
    let newContent = content
    if (op === "set" || op === "unset") {
      const key = params.key!
      const lines = content.split("\n")
      const idx = lines.findIndex((l) => l.trimStart().startsWith(key + "=") || l.trimStart().startsWith(key + " ="))
      if (op === "set") {
        const needsQuote = (params.value ?? "").includes(" ") || (params.value ?? "").includes("#")
        const newLine = `${key}=${needsQuote ? `"${(params.value ?? "").replace(/"/g, '\\"')}"` : (params.value ?? "")}`
        if (idx >= 0) {
          lines[idx] = newLine
        } else {
          lines.push(newLine)
        }
        newContent = lines.join("\n")
      } else {
        newContent = idx >= 0 ? lines.filter((_, i) => i !== idx).join("\n") : content
      }
    } else {
      newContent = serializeEnv(vars)
    }

    await writeFile(filePath, newContent.endsWith("\n") ? newContent : newContent + "\n", "utf8")
    return {
      title: `env ${op}`,
      output: `✅ Updated ${path.basename(filePath)}${params.key ? ` — ${params.key}` : ` (${Object.keys(params.vars ?? {}).length} vars)`}`,
      metadata: { file: path.relative(base, filePath) } as Meta,
    }
  },
})

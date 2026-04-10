/**
 * Context-based MCP auto-detection.
 *
 * Scans the current project for signals and returns a list of built-in MCP
 * server IDs that should be auto-enabled based on what is detected.
 *
 * Detection signals:
 *   git-remote   — matches against git remote URL patterns
 *   env-key      — checks if an env var is set and optionally matches its prefix
 *   file-glob    — checks if any file matching the glob exists under the project root
 *   package-dep  — checks package.json dependencies for a named package
 *   always       — always triggers (unconditional)
 */

import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { McpBuiltins } from "./builtins"

const log = Log.create({ service: "mcp.autodetect" })

/** Cache results per project root so detection only runs once per session. */
const _cache = new Map<string, string[]>()

/** Runs all auto-detect rules and returns matched builtin IDs. */
export async function autoDetectBuiltins(projectRoot: string): Promise<string[]> {
  const cached = _cache.get(projectRoot)
  if (cached) return cached

  const context = await collectContext(projectRoot)
  const matched: string[] = []

  for (const entry of McpBuiltins.catalog) {
    if (entry.launchMode === "manual") continue
    if (matchesAny(entry.autoDetect, context)) {
      matched.push(entry.id)
    }
  }

  log.info("auto-detect complete", { projectRoot, matched })
  _cache.set(projectRoot, matched)
  return matched
}

export function clearAutoDetectCache(projectRoot?: string) {
  if (projectRoot) {
    _cache.delete(projectRoot)
  } else {
    _cache.clear()
  }
}

// ── Context collection ────────────────────────────────────────────────────────

interface ProjectContext {
  gitRemotes: string[]
  envKeys: Set<string>
  hasFile: (pattern: string) => boolean
  packageDeps: Set<string>
}

async function collectContext(root: string): Promise<ProjectContext> {
  const [gitRemotes, packageDeps] = await Promise.all([
    readGitRemotes(root),
    readPackageDeps(root),
  ])

  return {
    gitRemotes,
    envKeys: new Set(Object.keys(process.env)),
    hasFile: (pattern) => checkFileExists(root, pattern),
    packageDeps,
  }
}

async function readGitRemotes(root: string): Promise<string[]> {
  const configPath = path.join(root, ".git", "config")
  if (!existsSync(configPath)) return []
  try {
    const text = await readFile(configPath, "utf8")
    const urls: string[] = []
    for (const match of text.matchAll(/url\s*=\s*(.+)/g)) {
      urls.push(match[1]!.trim())
    }
    return urls
  } catch {
    return []
  }
}

async function readPackageDeps(root: string): Promise<Set<string>> {
  const pkgPath = path.join(root, "package.json")
  if (!existsSync(pkgPath)) return new Set()
  try {
    const raw = await readFile(pkgPath, "utf8")
    const pkg = JSON.parse(raw) as Record<string, unknown>
    const deps = new Set<string>()
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      const section = pkg[key]
      if (section && typeof section === "object") {
        for (const dep of Object.keys(section as object)) deps.add(dep)
      }
    }
    return deps
  } catch {
    return new Set()
  }
}

function checkFileExists(root: string, pattern: string): boolean {
  // Fast exact check first
  if (existsSync(path.join(root, pattern))) return true
  // Simple wildcard support for common cases
  if (pattern.includes("**")) {
    // Avoid expensive glob — just check if the pattern base dir hint exists
    const base = pattern.split("**")[0]!.replace(/[*?]/g, "").replace(/\/$/, "")
    if (base && existsSync(path.join(root, base))) return true
  }
  if (pattern.includes("*")) {
    // Only handle "*.ext" or "dir/*.ext" patterns
    const dir = path.join(root, path.dirname(pattern))
    const ext = path.extname(pattern)
    if (existsSync(dir) && ext) {
      try {
        const { readdirSync } = require("fs") as typeof import("fs")
        return readdirSync(dir).some((f: string) => f.endsWith(ext))
      } catch {
        return false
      }
    }
  }
  return false
}

// ── Rule matching ─────────────────────────────────────────────────────────────

function matchesAny(rules: McpBuiltins.AutoDetectRule[], ctx: ProjectContext): boolean {
  return rules.some((rule) => matchRule(rule, ctx))
}

function matchRule(rule: McpBuiltins.AutoDetectRule, ctx: ProjectContext): boolean {
  switch (rule.type) {
    case "always":
      return true

    case "git-remote": {
      if (!rule.pattern) return ctx.gitRemotes.length > 0
      const re = new RegExp(rule.pattern, "i")
      return ctx.gitRemotes.some((url) => re.test(url))
    }

    case "env-key": {
      if (!rule.pattern) return false
      return [...ctx.envKeys].some((k) => k.startsWith(rule.pattern!) || k === rule.pattern)
    }

    case "file-glob":
      return rule.pattern ? ctx.hasFile(rule.pattern) : false

    case "package-dep":
      return rule.pattern ? ctx.packageDeps.has(rule.pattern) : false

    default:
      return false
  }
}

/**
 * Config file management tool.
 *
 * Read, validate, and update common config files:
 * tsconfig.json, package.json, biome.json, eslint.config.*, .prettierrc,
 * tailwind.config.*, vite.config.*, next.config.*.
 */

import z from "zod"
import { Tool } from "./tool"
import { readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../project/instance"

const KNOWN_CONFIGS: Record<string, { desc: string; candidates: string[] }> = {
  tsconfig: { desc: "TypeScript compiler config", candidates: ["tsconfig.json", "tsconfig.base.json", "tsconfig.app.json"] },
  package: { desc: "package.json", candidates: ["package.json"] },
  biome: { desc: "Biome linter/formatter", candidates: ["biome.json", "biome.jsonc"] },
  eslint: { desc: "ESLint config", candidates: [".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs"] },
  prettier: { desc: "Prettier formatter", candidates: [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"] },
  tailwind: { desc: "Tailwind CSS", candidates: ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs"] },
  vite: { desc: "Vite build tool", candidates: ["vite.config.ts", "vite.config.js", "vite.config.mjs"] },
  next: { desc: "Next.js config", candidates: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  docker: { desc: "Docker Compose", candidates: ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] },
  gitignore: { desc: ".gitignore", candidates: [".gitignore"] },
}

function resolveConfigPath(nameOrPath: string, base: string): string | null {
  if (path.isAbsolute(nameOrPath)) return existsSync(nameOrPath) ? nameOrPath : null
  // Check if it's a known alias
  const known = KNOWN_CONFIGS[nameOrPath.toLowerCase()]
  if (known) {
    for (const c of known.candidates) {
      const full = path.join(base, c)
      if (existsSync(full)) return full
    }
    return null
  }
  // Direct relative path
  const full = path.join(base, nameOrPath)
  return existsSync(full) ? full : null
}

function tryParse(content: string): { parsed: unknown; isJson: boolean; isYaml: boolean } {
  // Try JSON (with trailing commas stripped for JSONC)
  try {
    const clean = content.replace(/^\s*\/\/[^\n]*/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const parsed = JSON.parse(clean)
    return { parsed, isJson: true, isYaml: false }
  } catch {}
  // Not YAML parser available — treat as raw
  const isYaml = /^(\w+):\s/m.test(content)
  return { parsed: null, isJson: false, isYaml }
}

function applyDotPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".")
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(part in cur) || typeof cur[part] !== "object") cur[part] = {}
    cur = cur[part] as Record<string, unknown>
  }
  const last = parts[parts.length - 1]!
  cur[last] = value
}

function getDotPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split(".")
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

type Meta = Record<string, unknown>

export const ConfigTool= Tool.define("config", {
  description:
    "Read, validate, and update config files: tsconfig, package, biome, eslint, prettier, tailwind, vite, next, docker, gitignore — or any JSON/YAML file. Supports dot-path key access (e.g. 'compilerOptions.strict'). Use `set` to update a specific key, `get` to read a key, `read` to view full file, `list` to discover config files in the project.",
  parameters: z.object({
    operation: z.enum(["read", "get", "set", "validate", "list"]).describe(
      "read: view file | get: read a specific key | set: update a key | validate: check JSON validity | list: find all config files",
    ),
    config: z.string().optional().describe(
      "Config alias (tsconfig/package/biome/eslint/prettier/tailwind/vite/next/docker/gitignore) or file path",
    ),
    key: z.string().optional().describe("Dot-path key for get/set, e.g. 'compilerOptions.strict' or 'scripts.build'"),
    value: z.unknown().optional().describe("Value to set (for set operation) — any JSON-compatible value"),
  }),
  async execute(params, _ctx) {
    const base = Instance.worktree || Instance.directory

    if (params.operation === "list") {
      const found: string[] = []
      for (const [alias, info] of Object.entries(KNOWN_CONFIGS)) {
        for (const c of info.candidates) {
          const full = path.join(base, c)
          if (existsSync(full)) {
            found.push(`  ${c}  (${info.desc})`)
            break
          }
        }
      }
      return {
        title: "config list",
        output: found.length ? `Config files found:\n${found.join("\n")}` : "No known config files found in project root.",
        metadata: { count: found.length } as Meta,
      }
    }

    if (!params.config) {
      return { title: "config", output: "Error: `config` is required for this operation.", metadata: {} as Meta }
    }

    const filePath = resolveConfigPath(params.config, base)

    if (!filePath) {
      return {
        title: "config",
        output: `Config not found: ${params.config}\n\nKnown aliases: ${Object.keys(KNOWN_CONFIGS).join(", ")}`,
        metadata: {} as Meta,
      }
    }

    const content = await readFile(filePath, "utf8")
    const { parsed, isJson } = tryParse(content)
    const rel = path.relative(base, filePath)

    if (params.operation === "read") {
      const truncated = content.length > 20_000 ? content.slice(0, 20_000) + "\n…[truncated]" : content
      return { title: `config read — ${rel}`, output: truncated, metadata: { file: rel, size: content.length } as Meta }
    }

    if (params.operation === "validate") {
      if (isJson) {
        return { title: `config validate — ${rel}`, output: `✅ Valid JSON: ${rel}`, metadata: { valid: true } as Meta }
      }
      return { title: `config validate — ${rel}`, output: `⚠️ ${rel} is not JSON — cannot validate syntax automatically.`, metadata: { valid: false } as Meta }
    }

    if (params.operation === "get") {
      if (!params.key) return { title: "config get", output: "Error: `key` is required", metadata: {} as Meta }
      if (!isJson || !parsed) return { title: "config get", output: "Cannot read key from non-JSON config.", metadata: {} as Meta }
      const val = getDotPath(parsed, params.key)
      return {
        title: `config get — ${rel} → ${params.key}`,
        output: val === undefined ? `Key not found: ${params.key}` : JSON.stringify(val, null, 2),
        metadata: { key: params.key, found: val !== undefined } as Meta,
      }
    }

    if (params.operation === "set") {
      if (!params.key) return { title: "config set", output: "Error: `key` is required", metadata: {} as Meta }
      if (!isJson || !parsed) return { title: "config set", output: "Can only set keys in JSON configs.", metadata: {} as Meta }
      const obj = parsed as Record<string, unknown>
      applyDotPath(obj, params.key, params.value)
      const newContent = JSON.stringify(obj, null, 2) + "\n"
      await writeFile(filePath, newContent, "utf8")
      return {
        title: `config set — ${rel}`,
        output: `✅ Set ${params.key} = ${JSON.stringify(params.value)} in ${rel}`,
        metadata: { file: rel, key: params.key } as Meta,
      }
    }

    return { title: "config", output: "Unknown operation", metadata: {} as Meta }
  },
})

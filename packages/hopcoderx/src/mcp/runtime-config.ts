import { Config } from "../config/config"

const ENV_PLACEHOLDER = /\$\{env:([A-Z0-9_]+)\}/g
const MAX_STDERR_LINES = 8

function interpolateString(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(ENV_PLACEHOLDER, (_, key: string) => env[key] ?? "")
}

function collectEnvPlaceholders(value: unknown, found: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENV_PLACEHOLDER)) {
      found.add(match[1])
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEnvPlaceholders(item, found)
    return
  }
  if (!value || typeof value !== "object") return
  for (const item of Object.values(value)) {
    collectEnvPlaceholders(item, found)
  }
}

function interpolateValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") return interpolateString(value, env)
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, env))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateValue(item, env)]))
}

export function findMissingMcpEnvVars<T extends Config.Mcp>(config: T, env: NodeJS.ProcessEnv = process.env): string[] {
  const found = new Set<string>()
  collectEnvPlaceholders(config, found)
  return [...found].filter((key) => !env[key]).sort((a, b) => a.localeCompare(b))
}

export function resolveMcpRuntimeConfig<T extends Config.Mcp>(config: T, env: NodeJS.ProcessEnv = process.env): T {
  return interpolateValue(config, env) as T
}

export function formatMcpFailureMessage(message: string, stderr: string[]): string {
  const lines = stderr
    .flatMap((chunk) => chunk.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-MAX_STDERR_LINES)

  if (lines.length === 0) return message
  const detail = lines.join("\n")
  return message.includes(detail) ? message : `${message}\nStderr:\n${detail}`
}

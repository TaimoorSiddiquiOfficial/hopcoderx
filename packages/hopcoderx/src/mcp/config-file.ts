import path from "path"
import { modify, applyEdits } from "jsonc-parser"
import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import { McpBuiltins } from "./builtins"

export type PersistedMcpEntry = Config.Mcp | { enabled: boolean }

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry | undefined): entry is Config.Mcp {
  return typeof entry === "object" && entry !== null && "type" in entry
}

export async function resolveMcpConfigPath(baseDir: string, options?: { global?: boolean }) {
  const candidates = options?.global
    ? ["hopcoderx.jsonc", "hopcoderx.json", "config.json"].map((file) => path.join(baseDir, file))
    : [
        path.join(baseDir, "hopcoderx.jsonc"),
        path.join(baseDir, "hopcoderx.json"),
        path.join(baseDir, ".hopcoderx", "hopcoderx.jsonc"),
        path.join(baseDir, ".hopcoderx", "hopcoderx.json"),
      ]

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

export async function updateMcpConfigEntry(name: string, mcpConfig: PersistedMcpEntry | undefined, configPath: string) {
  let text = "{}"
  if (await Filesystem.exists(configPath)) {
    text = await Filesystem.readText(configPath)
  }

  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Filesystem.write(configPath, result)
  return configPath
}

export function buildDisabledMcpEntry(name: string, configMcp?: NonNullable<Config.Info["mcp"]>): PersistedMcpEntry | undefined {
  const existing = configMcp?.[name]
  if (isMcpConfigured(existing)) {
    return {
      ...existing,
      enabled: false,
    }
  }

  const builtin = McpBuiltins.getById(name)
  if (builtin) {
    return {
      ...McpBuiltins.toMcpConfig(builtin, false),
      enabled: false,
    }
  }

  if (existing && typeof existing === "object" && "enabled" in existing) {
    return { enabled: false }
  }

  return undefined
}

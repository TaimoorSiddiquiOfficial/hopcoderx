import { Config } from "../config/config"
import { HubManifest } from "./manifest"
import { HubStatus } from "./status"
import { McpRegistry } from "../mcp/registry"
import { MCP } from "../mcp"
import { resolveMcpConfigPath, updateMcpConfigEntry } from "../mcp/config-file"
import type { SkillManifest } from "../skills/framework"

export namespace HubInstall {
  export type McpInstallResult = {
    id: string
    name: string
    enabled: boolean
    readiness: string
    reason?: string
  }

  export type EmbeddedInstallResult = {
    id: string
    name: string
    required: boolean
    registered: boolean
    enabled: boolean
    readiness?: string
    reason?: string
  }

  function resolveEmbeddedEntry(embedded: NonNullable<SkillManifest["embeddedMcp"]>[number]) {
    const candidates = [embedded.registryName, embedded.id, embedded.name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/^mcp:/, ""))

    for (const candidate of candidates) {
      const entry = McpRegistry.getByName(candidate)
      if (entry) return entry
    }
    return undefined
  }

  export async function installRegistryMcp(
    name: string,
    input: {
      directory: string
      configMcp?: NonNullable<Config.Info["mcp"]>
    },
  ): Promise<McpInstallResult> {
    const entry = McpRegistry.getByName(name)
    if (!entry) {
      throw new Error(`Unknown MCP item '${name}'`)
    }

    const nextConfig: Config.Mcp = {
      ...McpRegistry.formatConfig(entry),
      ...(input.configMcp?.[entry.name] && typeof input.configMcp[entry.name] === "object" ? input.configMcp[entry.name] : {}),
      enabled: true,
    }
    const state = await HubStatus.resolveCurrentMcp(entry, { config: nextConfig })
    const persisted: Config.Mcp = {
      ...nextConfig,
      enabled: state.effectiveEnabled,
    }
    const configPath = await resolveMcpConfigPath(input.directory)

    await MCP.add(entry.name, persisted)
    await updateMcpConfigEntry(entry.name, persisted, configPath)

    return {
      id: HubManifest.normalizeID("mcp", entry.name),
      name: entry.name,
      enabled: persisted.enabled ?? false,
      readiness: state.readiness,
      reason: state.reason,
    }
  }

  export async function installSkillEmbeddedMcp(
    manifest: Pick<SkillManifest, "embeddedMcp">,
    input: {
      directory: string
      configMcp?: NonNullable<Config.Info["mcp"]>
    },
  ): Promise<EmbeddedInstallResult[]> {
    const embedded = manifest.embeddedMcp ?? []
    if (!embedded.length) return []

    const configPath = await resolveMcpConfigPath(input.directory)
    const currentConfig = {
      ...(input.configMcp ?? (await Config.get()).mcp),
    }

    const results: EmbeddedInstallResult[] = []
    for (const item of embedded) {
      const entry = resolveEmbeddedEntry(item)
      if (!entry) {
        results.push({
          id: item.id,
          name: item.registryName ?? item.name,
          required: item.required !== false,
          registered: false,
          enabled: false,
          reason: "No matching MCP registry entry was found for this embedded dependency.",
        })
        continue
      }

      const installed = await installRegistryMcp(entry.name, {
        directory: input.directory,
        configMcp: currentConfig,
      })
      currentConfig[entry.name] = {
        ...McpRegistry.formatConfig(entry),
        enabled: installed.enabled,
      }

      results.push({
        id: item.id,
        name: installed.name,
        required: item.required !== false,
        registered: true,
        enabled: installed.enabled,
        readiness: installed.readiness,
        reason: installed.reason,
      })
    }

    return results
  }

  export async function installBundle(
    bundle: HubManifest.Bundle,
    input: {
      directory: string
      configMcp?: NonNullable<Config.Info["mcp"]>
    },
  ) {
    const results: Array<
      | ({ kind: "mcp" } & McpInstallResult)
      | { kind: HubManifest.Kind; id: string; name: string; enabled: false; reason: string }
    > = []
    const currentConfig = {
      ...(input.configMcp ?? (await Config.get()).mcp),
    }

    for (const item of bundle.items) {
      if (item.kind !== "mcp") {
        results.push({
          kind: item.kind,
          id: item.id,
          name: item.id,
          enabled: false,
          reason: "Bundle installation currently supports MCP items only.",
        })
        continue
      }

      const installed = await installRegistryMcp(item.id.replace(/^mcp:/, ""), {
        directory: input.directory,
        configMcp: currentConfig,
      })
      currentConfig[installed.name] = {
        ...McpRegistry.formatConfig(McpRegistry.getByName(installed.name)!),
        enabled: installed.enabled,
      }
      results.push({
        kind: "mcp",
        ...installed,
      })
    }

    return results
  }
}

import { Config } from "../config/config"
import { HubManifest } from "./manifest"
import { HubBundles } from "./bundles"
import { HubStatus } from "./status"
import { McpRegistry } from "../mcp/registry"
import { MCP } from "../mcp"
import { resolveMcpConfigPath, updateMcpConfigEntry } from "../mcp/config-file"
import { Skill } from "../skill/skill"
import type { SkillManifest } from "../skills/framework"
import { SkillsMarketplace } from "../skills/marketplace"

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

  export type BundleInstallResult = {
    items: Array<
      | ({ kind: "mcp" } & McpInstallResult)
      | { kind: HubManifest.Kind; id: string; name: string; enabled: boolean; reason?: string }
    >
    recommendedAgent?: string
    aliases: string[]
    starterPrompts: string[]
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
  ): Promise<BundleInstallResult> {
    const results: BundleInstallResult["items"] = []
    const currentConfig = {
      ...(input.configMcp ?? (await Config.get()).mcp),
    }
    const builtinSkills = await Skill.all()
    const marketplaceSkills = await new SkillsMarketplace().list()

    for (const item of bundle.items) {
      if (item.kind === "skill") {
        const localSkill = builtinSkills.find(
          (skill) =>
            item.id === `skill:${skill.source.kind}:${skill.name.trim().toLowerCase()}` ||
            item.id === skill.name ||
            item.id.endsWith(`:${skill.name.trim().toLowerCase()}`),
        )
        if (localSkill) {
          results.push({
            kind: "skill",
            id: item.id,
            name: localSkill.name,
            enabled: true,
            reason: item.reason ?? "Skill is bundled and already available locally.",
          })
          continue
        }

        const installedSkill = marketplaceSkills.find((skill) => skill.name === item.id || skill.manifest.id === item.id)
        if (installedSkill) {
          results.push({
            kind: "skill",
            id: item.id,
            name: installedSkill.manifest.name,
            enabled: true,
            reason: item.reason ?? "Marketplace skill is already installed.",
          })
          continue
        }

        results.push({
          kind: item.kind,
          id: item.id,
          name: item.id,
          enabled: false,
          reason: "Skill relation is not installed yet. Add marketplace install orchestration for this bundle item next.",
        })
        continue
      }

      if (item.kind !== "mcp") {
        results.push({
          kind: item.kind,
          id: item.id,
          name: item.id,
          enabled: false,
          reason: "Bundle installation currently supports MCP and skill relations only.",
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

    return {
      items: results,
      recommendedAgent: bundle.recommendedAgent,
      aliases: bundle.aliases,
      starterPrompts: bundle.starterPrompts,
    }
  }

  export async function installPreset(
    preset: HubManifest.Preset,
    input: {
      directory: string
      configMcp?: NonNullable<Config.Info["mcp"]>
    },
  ) {
    const results: Array<{
      kind: HubManifest.Kind
      id: string
      name: string
      enabled: boolean
      reason?: string
    }> = []
    const currentConfig = {
      ...(input.configMcp ?? (await Config.get()).mcp),
    }

    for (const relation of preset.appliesTo) {
      if (relation.kind === "bundle") {
        const bundle = HubBundles.get(relation.id)
        if (!bundle) {
          results.push({
            kind: relation.kind,
            id: relation.id,
            name: relation.id,
            enabled: false,
            reason: "Referenced bundle was not found.",
          })
          continue
        }
        const installed = await installBundle(bundle, {
          directory: input.directory,
          configMcp: currentConfig,
        })
        for (const item of installed.items) {
          results.push({
            kind: item.kind,
            id: item.id,
            name: item.name,
            enabled: item.enabled,
            reason: item.reason,
          })
        }
        continue
      }

      if (relation.kind === "mcp") {
        const installed = await installRegistryMcp(relation.id.replace(/^mcp:/, ""), {
          directory: input.directory,
          configMcp: currentConfig,
        })
        results.push({
          kind: "mcp",
          id: installed.id,
          name: installed.name,
          enabled: installed.enabled,
          reason: installed.reason,
        })
        continue
      }

      results.push({
        kind: relation.kind,
        id: relation.id,
        name: relation.id,
        enabled: false,
        reason: "Preset installation currently supports bundle and MCP relations only.",
      })
    }

    return {
      items: results,
      onboarding: preset.onboarding,
    }
  }
}

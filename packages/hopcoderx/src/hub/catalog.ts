import { z } from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { HubManifest } from "./manifest"
import { HubStatus } from "./status"
import { McpRegistry } from "../mcp/registry"
import { Skill } from "../skill/skill"
import { SkillsMarketplace } from "../skills/marketplace"

export namespace HubCatalog {
  export const Item = z.object({
    manifest: HubManifest.Any,
    installed: z.boolean(),
    available: z.boolean(),
    packageName: z.string().optional(),
    location: z.string().optional(),
    status: HubStatus.MCPState.optional(),
  })
  export type Item = z.infer<typeof Item>

  function skillSource(kind: Skill.Source["kind"]): HubManifest.Source {
    switch (kind) {
      case "builtin":
        return "builtin"
      case "remote-github":
        return "github"
      case "remote-index":
        return "registry"
      case "external-project":
      case "config-directory":
      case "config-path":
      case "external-global":
      default:
        return "local"
    }
  }

  function markdownSkillID(skill: Skill.Info) {
    return `skill:${skill.source.kind}:${skill.name.trim().toLowerCase()}`
  }

  function marketplaceSkillID(packageName: string, manifest: { id: string }) {
    return `skill:marketplace:${packageName.trim().toLowerCase() || manifest.id.trim().toLowerCase()}`
  }

  export async function list(input: {
    configMcp?: NonNullable<Config.Info["mcp"]>
    mcpRuntime?: Record<string, MCP.Status>
  } = {}): Promise<Item[]> {
    const items: Item[] = []

    const mcpStates = await HubStatus.resolveAllMcp({
      configMcp: input.configMcp,
      runtime: input.mcpRuntime,
    })
    for (const state of mcpStates) {
      items.push({
        manifest: state.manifest,
        installed: state.configured,
        available: state.authConfigured || !state.manifest.auth.required,
        status: state,
      })
    }

    const markdownSkills = await Skill.all()
    for (const skill of markdownSkills) {
      items.push({
        manifest: HubManifest.Skill.parse({
          id: markdownSkillID(skill),
          kind: "skill",
          name: skill.name,
          description: skill.description,
          source: skillSource(skill.source.kind),
          location: skill.location,
          docs: skill.location,
          permissions: [],
          category: skill.category,
          tags: skill.tags ?? [],
          homepage: skill.homepage,
          activation: {
            defaultEnabled: true,
            autoDisableWhenMissing: false,
            requiresSetup: false,
          },
          auth: skill.auth ?? {
            mode: "none",
            required: false,
            envKeys: [],
          },
          embeddedMcp: skill.embeddedMcp ?? [],
          presets: skill.presets ?? [],
        }),
        installed: true,
        available: true,
        location: skill.location,
      })
    }

    const marketplace = new SkillsMarketplace()
    const installedMarketplaceSkills = await marketplace.list()
    for (const installed of installedMarketplaceSkills) {
      items.push({
        manifest: HubManifest.Skill.parse({
          id: marketplaceSkillID(installed.name, installed.manifest),
          kind: "skill",
          name: installed.manifest.name,
          description: installed.manifest.description,
          version: installed.manifest.version,
          source: "marketplace",
          permissions: installed.manifest.permissions,
          npm: installed.name,
          minHostVersion: installed.manifest.minHostVersion,
          docs: installed.manifest.docs,
          author: installed.manifest.author,
          category: installed.manifest.category,
          tags: installed.manifest.tags ?? [],
          homepage: installed.manifest.homepage,
          auth: installed.manifest.auth ?? {
            mode: "none",
            required: false,
            envKeys: [],
          },
          embeddedMcp: installed.manifest.embeddedMcp ?? [],
          presets: installed.manifest.presets ?? [],
          activation: {
            defaultEnabled: true,
            autoDisableWhenMissing: false,
            requiresSetup: false,
          },
        }),
        installed: true,
        available: installed.manifest.requiredEnv.every((key) => Boolean(process.env[key]?.trim())),
        packageName: installed.name,
        location: installed.path,
      })
    }

    return items
  }

  export async function get(
    id: string,
    input: {
      configMcp?: NonNullable<Config.Info["mcp"]>
      mcpRuntime?: Record<string, MCP.Status>
    } = {},
  ) {
    const items = await list(input)
    return items.find(
      (item) =>
        item.manifest.id === id ||
        item.manifest.name === id ||
        item.packageName === id ||
        item.status?.name === id ||
        `mcp:${item.status?.name}` === id,
    )
  }
}

/**
 * HopHub — HopCoderX skills & plugins marketplace CLI.
 *
 * Discover, install, and publish skills/plugins via NPM registry.
 * Uses a JSON registry index for fast discovery + metadata.
 *
 * CLI:
 *   hopcoderx hub search [query]    Search the registry
 *   hopcoderx hub install <pkg>     Install a skill or plugin
 *   hopcoderx hub publish           Publish current dir as a skill
 *   hopcoderx hub list              List installed packages
 *   hopcoderx hub update [pkg]      Update installed packages
 *   hopcoderx hub uninstall <pkg>   Remove a package
 *   hopcoderx hub info <pkg>        Show details about a package
 *
 * Registry index: ~/.hopcoderx/hub-registry.json (refreshed every 24h)
 */

import { readFile, writeFile, mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { Config } from "../../config/config"
import { HubCatalog } from "../../hub/catalog"
import { HubBundles } from "../../hub/bundles"
import { HubStatus } from "../../hub/status"
import { HubInstall } from "../../hub/install"
import { McpRegistry } from "../../mcp/registry"
import { MCP } from "../../mcp"
import { buildDisabledMcpEntry, buildEnabledMcpEntry, resolveMcpConfigPath, updateMcpConfigEntry } from "../../mcp/config-file"
import { SkillsMarketplace } from "../../skills/marketplace"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"

const execAsync = promisify(execFile)

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY_URL = "https://registry.hopcoderx.dev/hub/index.json"
const REGISTRY_FALLBACK = "https://registry.npmjs.org/-/v1/search?text=keywords:hopcoderx-skill&size=50"
const REGISTRY_CACHE = () => join(Global.Path.config, "hub-registry.json")
const INSTALLED_INDEX = () => join(Global.Path.config, "hub-installed.json")
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

interface HubPackage {
  id: string
  name: string          // npm package name
  description: string
  version: string
  type: "skill" | "plugin" | "provider" | "channel" | "theme"
  author?: string
  homepage?: string
  downloads?: number
  tags?: string[]
}

interface RegistryIndex {
  updatedAt: string
  packages: HubPackage[]
}

interface InstalledIndex {
  packages: Record<string, { version: string; installedAt: string; type: string }>
}

function resolveMcpName(id: string) {
  return id.startsWith("mcp:") ? id.slice(4) : id
}

async function loadRegistry(): Promise<RegistryIndex> {
  const cachePath = REGISTRY_CACHE()
  if (existsSync(cachePath)) {
    const raw = JSON.parse(await readFile(cachePath, "utf8"))
    if (Date.now() - new Date(raw.updatedAt).getTime() < CACHE_TTL_MS) {
      return raw
    }
  }

  // Try official registry first, fall back to NPM keyword search
  let registry: RegistryIndex
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      registry = await res.json() as RegistryIndex
    } else {
      throw new Error(`${res.status}`)
    }
  } catch {
    // Fall back to NPM search
    const res = await fetch(REGISTRY_FALLBACK, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) throw new Error("Failed to reach NPM registry")
    const data = await res.json() as { objects: { package: { name: string; description: string; version: string; author?: { name?: string }; links?: { homepage?: string } } }[] }
    registry = {
      updatedAt: new Date().toISOString(),
      packages: data.objects.map((o) => ({
        id: o.package.name,
        name: o.package.name,
        description: o.package.description ?? "",
        version: o.package.version ?? "?",
        type: "skill" as const,
        author: o.package.author?.name,
        homepage: o.package.links?.homepage,
      })),
    }
  }

  await mkdir(Global.Path.config, { recursive: true })
  await writeFile(cachePath, JSON.stringify(registry, null, 2))
  return registry
}

async function loadInstalled(): Promise<InstalledIndex> {
  const path = INSTALLED_INDEX()
  if (!existsSync(path)) return { packages: {} }
  return JSON.parse(await readFile(path, "utf8"))
}

async function saveInstalled(idx: InstalledIndex): Promise<void> {
  await mkdir(Global.Path.config, { recursive: true })
  await writeFile(INSTALLED_INDEX(), JSON.stringify(idx, null, 2))
}

// ─── HubCommand ───────────────────────────────────────────────────────────────

export const HubCommand = cmd({
  command: "hub <action> [package]",
  describe: "HopHub — skills & plugins marketplace (search, install, publish)",
  builder(yargs: Argv) {
    return yargs
      .positional("action", {
        type: "string",
        choices: ["search", "install", "publish", "list", "update", "uninstall", "info", "enable", "disable", "auth", "doctor"] as const,
        describe: "Action to perform",
      })
      .positional("package", {
        type: "string",
        describe: "Package name (NPM identifier)",
      })
      .option("tag", {
        type: "string",
        describe: "Filter search results by tag",
      })
      .option("type", {
        type: "string",
        choices: ["mcp", "skill", "bundle", "preset", "plugin", "provider", "channel", "theme"],
        describe: "Filter by package type",
      })
      .option("json", {
        type: "boolean",
        describe: "Output as JSON",
        default: false,
      })
      .option("global", {
        type: "boolean",
        describe: "Install globally (not just current project)",
        default: false,
      })
  },
  async handler(args) {
    const action = args.action ?? "list"

    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      fn: async () => {
        const config = await Config.get()

        if (action === "search" || action === "list") {
          const query = action === "search" ? args.package?.toLowerCase() : undefined
          let items = await HubCatalog.list({
            configMcp: config.mcp,
          })
          if (args.type && ["mcp", "skill", "bundle", "preset"].includes(args.type)) {
            items = items.filter((item) => item.manifest.kind === args.type)
          }
          if (query) {
            items = items.filter(
              (item) =>
                item.manifest.name.toLowerCase().includes(query) ||
                item.manifest.description.toLowerCase().includes(query) ||
                item.manifest.tags.some((tag) => tag.toLowerCase().includes(query)),
            )
          }

          if (args.json) {
            console.log(JSON.stringify(items, null, 2))
            return
          }

          if (items.length === 0) {
            console.log(action === "search" ? `No hub items found for '${args.package}'.` : "No hub items found.")
            return
          }

          console.log(`\n${action === "search" ? "Matching" : "Available"} hub items (${items.length}):\n`)
          for (const item of items) {
            const status = item.status ? ` [${item.status.readiness}]` : ""
            const installed = item.installed ? " [installed]" : ""
            console.log(`  ${item.manifest.id}${installed}${status}`)
            console.log(`  ${item.manifest.description}`)
            if (item.packageName) console.log(`  Package: ${item.packageName}`)
            console.log()
          }
          return
        }

        if (action === "info") {
          const target = args.package
          if (!target) { console.error("Usage: hopcoderx hub info <item>"); process.exit(1) }

          const item = await HubCatalog.get(target, {
            configMcp: config.mcp,
          })

          if (item) {
            if (args.json) {
              console.log(JSON.stringify(item, null, 2))
              return
            }

            console.log(`\nItem: ${item.manifest.id}`)
            console.log(`Name: ${item.manifest.name}`)
            console.log(`Kind: ${item.manifest.kind}`)
            console.log(`Description: ${item.manifest.description}`)
            console.log(`Installed: ${item.installed ? "yes" : "no"}`)
            if (item.packageName) console.log(`Package: ${item.packageName}`)
            if (item.status) {
              console.log(`Readiness: ${item.status.readiness}`)
              if (item.status.missingEnvKeys.length) {
                console.log(`Missing env: ${item.status.missingEnvKeys.join(", ")}`)
              }
              if (item.status.reason) console.log(`Reason: ${item.status.reason}`)
            }
            if (item.manifest.homepage) console.log(`Homepage: ${item.manifest.homepage}`)
            if (item.manifest.repository) console.log(`Repository: ${item.manifest.repository}`)
            return
          }

          let info: any
          try {
            const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(target)}/latest`)
            if (!res.ok) throw new Error(`${res.status}`)
            info = await res.json()
          } catch (err: any) {
            console.error(`Failed to fetch info for '${target}': ${err.message}`)
            process.exit(1)
          }

          if (args.json) { console.log(JSON.stringify(info, null, 2)); return }
          console.log(`\nPackage: ${info.name}@${info.version}`)
          console.log(`Description: ${info.description ?? "(none)"}`)
          return
        }

        if (action === "install") {
          const target = args.package
          if (!target) { console.error("Usage: hopcoderx hub install <item>"); process.exit(1) }

          const mcpName = resolveMcpName(target)
          const entry = McpRegistry.getByName(mcpName)
          if (entry || args.type === "mcp") {
            if (!entry) {
              console.error(`Unknown MCP item '${target}'`)
              process.exit(1)
            }
            const result = await HubInstall.installRegistryMcp(entry.name, {
              directory: Instance.directory,
              configMcp: config.mcp,
            })
            console.log(`✓ Installed MCP ${result.name}${result.enabled ? "" : " (disabled until configured)"}`)
            if (result.reason) console.log(`  ${result.reason}`)
            return
          }

          const bundle = HubBundles.get(target)
          if (bundle || args.type === "bundle") {
            if (!bundle) {
              console.error(`Unknown bundle item '${target}'`)
              process.exit(1)
            }
            const installed = await HubInstall.installBundle(bundle, {
              directory: Instance.directory,
              configMcp: config.mcp,
            })
            console.log(`✓ Installed bundle ${bundle.name}`)
            for (const item of installed) {
              console.log(
                `  - ${item.name}: ${item.enabled ? "enabled" : "registered disabled"}${item.reason ? ` — ${item.reason}` : ""}`,
              )
            }
            return
          }

          console.log(`Installing ${target}…`)
          try {
            const marketplace = new SkillsMarketplace(args.global ? process.cwd() : undefined)
            const result = await marketplace.install(target)
            const embedded = await HubInstall.installSkillEmbeddedMcp(result.manifest, {
              directory: Instance.directory,
              configMcp: config.mcp,
            })
            console.log(`✓ Installed ${result.name}@${result.version}`)
            if (embedded.length > 0) {
              console.log("  Embedded MCPs:")
              for (const item of embedded) {
                if (!item.registered) {
                  console.log(`  - ${item.name}: not registered (${item.reason ?? "registry entry not found"})`)
                  continue
                }
                console.log(
                  `  - ${item.name}: ${item.enabled ? "enabled" : "registered disabled"}${item.reason ? ` — ${item.reason}` : ""}`,
                )
              }
            }
          } catch (err: any) {
            console.error(`Failed to install '${target}': ${err.message}`)
            process.exit(1)
          }
          return
        }

        if (action === "enable" || action === "disable") {
          const target = args.package
          if (!target) { console.error(`Usage: hopcoderx hub ${action} <mcp>`); process.exit(1) }
          const name = resolveMcpName(target)
          const next =
            action === "enable"
              ? buildEnabledMcpEntry(name, config.mcp)
              : buildDisabledMcpEntry(name, config.mcp)
          if (!next) {
            console.error(`Unknown MCP item '${target}'`)
            process.exit(1)
          }
          const entry = McpRegistry.getByName(name)
          const finalConfig =
            action === "enable" && entry
              ? {
                  ...next,
                  enabled: (await HubStatus.resolveCurrentMcp(entry, { config: next })).effectiveEnabled,
                }
              : next
          const configPath = await resolveMcpConfigPath(Instance.directory)
          await updateMcpConfigEntry(name, finalConfig, configPath)
          console.log(`✓ ${action === "enable" ? "Enabled" : "Disabled"} ${name}`)
          if (action === "enable" && typeof finalConfig === "object" && "enabled" in finalConfig && finalConfig.enabled === false) {
            console.log("  Auth/setup is still missing, so the MCP remains disabled until configured.")
          }
          return
        }

        if (action === "auth") {
          const target = args.package
          if (!target) { console.error("Usage: hopcoderx hub auth <mcp>"); process.exit(1) }
          const name = resolveMcpName(target)
          const entry = McpRegistry.getByName(name)
          if (!entry) {
            console.error(`Unknown MCP item '${target}'`)
            process.exit(1)
          }
          const auth = McpRegistry.getAuth(entry)
          if (auth.mode !== "oauth") {
            console.error(`${name} does not expose an OAuth auth flow.`)
            process.exit(1)
          }
          await MCP.authenticate(name)
          console.log(`✓ Authenticated ${name}`)
          return
        }

        if (action === "doctor") {
          const runtime = await MCP.status().catch(() => ({}))
          const states = await HubStatus.resolveAllMcp({
            configMcp: config.mcp,
            runtime,
          })
          const issues = states.filter((state) => state.readiness !== "connected")

          if (args.json) {
            console.log(JSON.stringify(issues, null, 2))
            return
          }

          if (issues.length === 0) {
            console.log("All tracked MCP items are connected.")
            return
          }

          console.log(`Hub doctor found ${issues.length} MCP item(s) that need attention:\n`)
          for (const issue of issues) {
            console.log(`  ${issue.name}: ${issue.readiness}`)
            if (issue.missingEnvKeys.length) {
              console.log(`    Missing env: ${issue.missingEnvKeys.join(", ")}`)
            }
            if (issue.reason) {
              console.log(`    ${issue.reason}`)
            }
          }
          return
        }

        if (action === "uninstall") {
      const pkgName = args.package
      if (!pkgName) { console.error("Usage: hopcoderx hub uninstall <package>"); process.exit(1) }

      console.log(`Uninstalling ${pkgName}…`)
      try {
        await execAsync("bun", ["remove", pkgName], { cwd: process.cwd() })
        const installed = await loadInstalled()
        delete installed.packages[pkgName]
        await saveInstalled(installed)
        console.log(`✓ Uninstalled ${pkgName}`)
      } catch (err: any) {
        console.error(`Failed to uninstall '${pkgName}': ${err.message}`)
        process.exit(1)
      }
          return
        }

        if (action === "update") {
      const pkgName = args.package
      const installed = await loadInstalled()
      const toUpdate = pkgName ? [pkgName] : Object.keys(installed.packages)

      if (toUpdate.length === 0) {
        console.log("No packages installed.")
        return
      }

      for (const pkg of toUpdate) {
        console.log(`Updating ${pkg}…`)
        try {
          await execAsync("bun", ["update", pkg], { cwd: process.cwd() })
          console.log(`✓ Updated ${pkg}`)
        } catch (err: any) {
          console.error(`Failed to update '${pkg}': ${err.message}`)
        }
      }
          return
        }

        if (action === "publish") {
      console.log("Publishing to HopHub…")
      console.log("")
      console.log("Requirements:")
      console.log("  1. Your package.json must include keywords: ['hopcoderx-skill'] or ['hopcoderx-plugin']")
      console.log("  2. You must have a hopcoderx-plugin.json manifest at the root")
      console.log("  3. Run 'npm publish' or 'bun publish' to publish to NPM")
      console.log("")
      console.log("Then submit to the HopHub registry:")
      console.log("  https://github.com/TaimoorSiddiquiOfficial/hopcoderx/issues/new?template=hub-submission.yml")
      console.log("")
      try {
        await execAsync("bun", ["publish", "--access", "public"], { cwd: process.cwd() })
        console.log("✓ Published to NPM successfully!")
      } catch (err: any) {
        console.error(`Publish failed: ${err.message}`)
        console.error("Make sure you're logged in: bun login")
        process.exit(1)
      }
          return
        }
      },
    })
  },
})

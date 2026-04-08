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
        choices: ["search", "install", "publish", "list", "update", "uninstall", "info"] as const,
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
        choices: ["skill", "plugin", "provider", "channel", "theme"],
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

    if (action === "search") {
      const query = args.package
      let registry: RegistryIndex
      try {
        process.stdout.write("Fetching registry… ")
        registry = await loadRegistry()
        console.log("done")
      } catch (err: any) {
        console.error(`\nFailed to fetch registry: ${err.message}`)
        process.exit(1)
      }

      let results = registry.packages
      if (query) results = results.filter((p) => p.name.includes(query) || p.description.toLowerCase().includes(query.toLowerCase()))
      if (args.type) results = results.filter((p) => p.type === args.type)
      if (args.tag) results = results.filter((p) => p.tags?.includes(args.tag as string))

      if (args.json) {
        console.log(JSON.stringify(results, null, 2))
        return
      }

      if (results.length === 0) {
        console.log(`No packages found${query ? ` for '${query}'` : ""}.`)
        return
      }

      console.log(`\nFound ${results.length} package${results.length !== 1 ? "s" : ""}:\n`)
      for (const p of results) {
        const installed = (await loadInstalled()).packages[p.name]
        const badge = installed ? ` [installed ${installed.version}]` : ""
        console.log(`  ${p.name}@${p.version} (${p.type})${badge}`)
        console.log(`  ${p.description}`)
        if (p.author) console.log(`  Author: ${p.author}`)
        console.log()
      }
      return
    }

    if (action === "info") {
      const pkgName = args.package
      if (!pkgName) { console.error("Usage: hopcoderx hub info <package>"); process.exit(1) }

      let info: any
      try {
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`)
        if (!res.ok) throw new Error(`${res.status}`)
        info = await res.json()
      } catch (err: any) {
        console.error(`Failed to fetch info for '${pkgName}': ${err.message}`)
        process.exit(1)
      }

      if (args.json) { console.log(JSON.stringify(info, null, 2)); return }

      console.log(`\nPackage: ${info.name}@${info.version}`)
      console.log(`Description: ${info.description ?? "(none)"}`)
      console.log(`License: ${info.license ?? "unknown"}`)
      if (info.homepage) console.log(`Homepage: ${info.homepage}`)
      if (info.author?.name) console.log(`Author: ${info.author.name}`)
      if (info.keywords?.length) console.log(`Keywords: ${info.keywords.join(", ")}`)
      return
    }

    if (action === "install") {
      const pkgName = args.package
      if (!pkgName) { console.error("Usage: hopcoderx hub install <package>"); process.exit(1) }

      console.log(`Installing ${pkgName}…`)
      try {
        const installArgs = ["add", pkgName]
        if (args.global) installArgs.push("--global")
        await execAsync("bun", installArgs, { cwd: process.cwd() })

        const installed = await loadInstalled()
        // Try to get version from npm
        let version = "latest"
        try {
          const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`)
          if (res.ok) { const d = await res.json() as { version?: string }; version = d.version ?? "latest" }
        } catch { /* ignore */ }

        installed.packages[pkgName] = {
          version,
          installedAt: new Date().toISOString(),
          type: "unknown",
        }
        await saveInstalled(installed)
        console.log(`✓ Installed ${pkgName}@${version}`)
        console.log(`  Run 'hopcoderx hub list' to see installed packages.`)
      } catch (err: any) {
        console.error(`Failed to install '${pkgName}': ${err.message}`)
        process.exit(1)
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

    if (action === "list") {
      const installed = await loadInstalled()
      const pkgs = Object.entries(installed.packages)
      if (pkgs.length === 0) {
        console.log("No HopHub packages installed.")
        console.log("Run 'hopcoderx hub search' to discover packages.")
        return
      }
      if (args.json) { console.log(JSON.stringify(installed.packages, null, 2)); return }
      console.log(`Installed HopHub packages (${pkgs.length}):\n`)
      for (const [name, info] of pkgs) {
        console.log(`  ${name}@${info.version} (${info.type})`)
        console.log(`  Installed: ${new Date(info.installedAt).toLocaleDateString()}`)
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

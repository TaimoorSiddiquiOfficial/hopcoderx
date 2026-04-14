/**
 * HopCoderX Skills Marketplace
 *
 * Discover, install, and manage skills from the npm registry.
 * Skills are npm packages following the naming convention:
 *   hopcoderx-skill-<name>
 *
 * Each skill package must export a skill manifest at:
 *   package.json#hopcoderx.skill  (or a skill.manifest.json at root)
 *
 * Inspired by OpenClaw's ClawHub marketplace (https://clawhub.ai).
 *
 * Usage:
 *   const mp = new SkillsMarketplace()
 *   const results = await mp.search("github")
 *   await mp.install("hopcoderx-skill-github-pro")
 *   await mp.list()
 *   await mp.uninstall("hopcoderx-skill-github-pro")
 */

import { Log } from "../util/log"

import { execFile } from "child_process"
import { promisify } from "util"
import { readFile, readdir, mkdir, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import os from "os"
import { SkillFramework, type SkillManifest } from "./framework"
import { SkillRegistry, type Skill } from "./skills"

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketplaceSearchResult {
  /** npm package name */
  name: string
  /** Short description from npm */
  description: string
  /** Latest version */
  version: string
  /** Weekly downloads */
  downloads?: number
  /** Author */
  author?: string
  /** Homepage URL */
  homepage?: string
  /** npm package URL */
  npmUrl: string
}

export interface InstalledSkill {
  name: string
  version: string
  manifest: SkillManifest
  installedAt: Date
  path: string
}

// ─── SkillsMarketplace ────────────────────────────────────────────────────────

export class SkillsMarketplace {
  private readonly installDir: string
  private readonly framework: SkillFramework

  constructor(installDir?: string) {
    this.installDir = installDir ?? join(os.homedir(), ".hopcoderx", "skills")
    this.framework = new SkillFramework()
  }

  /**
   * Search npm for skills matching the query.
   * Results are filtered to `hopcoderx-skill-*` packages.
   */
  async search(query = ""): Promise<MarketplaceSearchResult[]> {
    const q = encodeURIComponent(`hopcoderx-skill-${query}`)
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${q}&size=20`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`npm search error: ${res.status}`)

    const data = await res.json() as {
      objects: Array<{
        package: {
          name: string
          description: string
          version: string
          author?: { name?: string }
          links?: { homepage?: string; npm?: string }
        }
        downloads?: { weekly?: number }
      }>
    }

    return data.objects
      .filter((o) => o.package.name.startsWith("hopcoderx-skill-"))
      .map((o) => ({
        name: o.package.name,
        description: o.package.description ?? "",
        version: o.package.version,
        downloads: o.downloads?.weekly,
        author: o.package.author?.name,
        homepage: o.package.links?.homepage,
        npmUrl: o.package.links?.npm ?? `https://www.npmjs.com/package/${o.package.name}`,
      }))
  }

  /**
   * Get details for a specific npm package (skill).
   */
  async info(packageName: string): Promise<MarketplaceSearchResult | null> {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`npm info error: ${res.status}`)
    const data = await res.json() as {
      name: string
      description: string
      version: string
      author?: { name?: string } | string
      homepage?: string
    }
    const authorName = typeof data.author === "string" ? data.author : data.author?.name
    return {
      name: data.name,
      description: data.description ?? "",
      version: data.version,
      author: authorName,
      homepage: data.homepage,
      npmUrl: `https://www.npmjs.com/package/${data.name}`,
    }
  }

  /**
   * Install a skill from npm into the HopCoderX skills directory.
   * Equivalent of `npm install hopcoderx-skill-<name>` in the skills dir.
   */
  async install(packageName: string, version?: string): Promise<InstalledSkill> {
    const pkg = version ? `${packageName}@${version}` : packageName
    await mkdir(this.installDir, { recursive: true })

    // Ensure a package.json exists so npm/bun can install into the dir
    const pkgJsonPath = join(this.installDir, "package.json")
    if (!existsSync(pkgJsonPath)) {
      await writeFile(pkgJsonPath, JSON.stringify({ name: "hopcoderx-skills-root", private: true, version: "1.0.0" }, null, 2))
    }

    // Prefer bun if available, fall back to npm
    const pm = await this._detectPackageManager()
    const installArgs = pm === "bun" ? ["add", pkg] : ["install", pkg]
    await execFileAsync(pm, installArgs, { cwd: this.installDir })

    // Resolve installed package path
    const pkgDir = join(this.installDir, "node_modules", packageName)
    if (!existsSync(pkgDir)) {
      throw new Error(`Install succeeded but package dir not found: ${pkgDir}`)
    }

    const manifest = await this._loadManifest(packageName, pkgDir)
    const result: InstalledSkill = { name: packageName, version: manifest.version, manifest, installedAt: new Date(), path: pkgDir }

    // Register in framework
    const skill = await this._loadSkillModule(pkgDir, manifest)
    this.framework.loadBuiltin(manifest, skill)

    Log.Default.info("skills.marketplace", "skill installed", { packageName, version: manifest.version })
    return result
  }

  /**
   * Uninstall a skill.
   */
  async uninstall(packageName: string): Promise<void> {
    const pm = await this._detectPackageManager()
    const removeArgs = pm === "bun" ? ["remove", packageName] : ["uninstall", packageName]
    await execFileAsync(pm, removeArgs, { cwd: this.installDir })
    Log.Default.info("skills.marketplace", "skill uninstalled", { packageName })
  }

  /**
   * List all installed marketplace skills.
   */
  async list(): Promise<InstalledSkill[]> {
    const nmDir = join(this.installDir, "node_modules")
    if (!existsSync(nmDir)) return []

    const dirs = await readdir(nmDir, { withFileTypes: true })
    const results: InstalledSkill[] = []

    for (const dirent of dirs) {
      if (!dirent.isDirectory() || !dirent.name.startsWith("hopcoderx-skill-")) continue
      const pkgDir = join(nmDir, dirent.name)
      try {
        const manifest = await this._loadManifest(dirent.name, pkgDir)
        results.push({ name: dirent.name, version: manifest.version, manifest, installedAt: new Date(0), path: pkgDir })
      } catch {
        // Skip malformed packages
      }
    }

    return results
  }

  /**
   * Load all installed marketplace skills into the SkillFramework.
   * Call this on startup to make installed skills available.
   */
  async loadAll(): Promise<number> {
    const installed = await this.list()
    let count = 0
    for (const s of installed) {
      try {
        const skill = await this._loadSkillModule(s.path, s.manifest)
        this.framework.loadBuiltin(s.manifest, skill)
        count++
      } catch (err) {
        Log.Default.warn("skills.marketplace", "failed to load skill", { name: s.name, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return count
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async _loadManifest(packageName: string, pkgDir: string): Promise<SkillManifest> {
    const pkgJson = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"))

    // Try hopcoderx.skill field in package.json first
    if (pkgJson.hopcoderx?.skill) {
      return {
        id: pkgJson.hopcoderx.skill.id ?? packageName.replace("hopcoderx-skill-", ""),
        name: pkgJson.hopcoderx.skill.name ?? pkgJson.name,
        description: pkgJson.hopcoderx.skill.description ?? pkgJson.description ?? "",
        version: pkgJson.version,
        requiredEnv: pkgJson.hopcoderx.skill.requiredEnv ?? [],
        permissions: pkgJson.hopcoderx.skill.permissions ?? ["network"],
        npm: packageName,
        author: typeof pkgJson.author === "string" ? pkgJson.author : pkgJson.author?.name,
      }
    }

    // Fall back to skill.manifest.json at root
    const manifestPath = join(pkgDir, "skill.manifest.json")
    if (existsSync(manifestPath)) {
      const raw = JSON.parse(await readFile(manifestPath, "utf8"))
      return { npm: packageName, version: pkgJson.version, ...raw }
    }

    // Minimal fallback
    return {
      id: packageName.replace("hopcoderx-skill-", ""),
      name: pkgJson.name,
      description: pkgJson.description ?? "",
      version: pkgJson.version,
      requiredEnv: [],
      permissions: ["network"],
      npm: packageName,
    }
  }

  private async _loadSkillModule(pkgDir: string, manifest: SkillManifest): Promise<Skill> {
    const pkgJson = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"))
    const main = pkgJson.main ?? pkgJson.module ?? "index.js"
    const mainPath = join(pkgDir, main)
    const mod = await import(mainPath) as { default?: Skill; skill?: Skill }
    const skill = mod.default ?? mod.skill
    if (!skill || typeof skill !== "object") {
      throw new Error(`${manifest.npm}: must export a default or named 'skill' Skill object`)
    }
    return skill
  }

  private async _detectPackageManager(): Promise<"bun" | "npm"> {
    try {
      await execFileAsync("bun", ["--version"])
      return "bun"
    } catch {
      return "npm"
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const marketplace = new SkillsMarketplace()

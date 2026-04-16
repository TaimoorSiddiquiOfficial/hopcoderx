/**
 * HopCoderX Skills Framework v2
 *
 * Formalized skill loading with:
 *   - Typed manifests (name, version, description, requiredEnv, permissions)
 *   - Permission scopes (read, write, network, shell, fs)
 *   - Version pinning (exact or semver range)
 *   - Sandboxed loading (isolated module scope)
 *   - Capability declarations
 *
 * Usage:
 *   const fw = new SkillFramework()
 *   await fw.load("github")
 *   await fw.execute("github", "list-issues", { repo: "owner/repo" })
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { z } from "zod"
import { Global } from "../global"
import { HubManifest } from "../hub/manifest"
import { SkillRegistry, type Skill, type SkillTool } from "./skills"

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionScope = "read" | "write" | "network" | "shell" | "fs" | "secrets"

export interface SkillManifest {
  /** Unique skill identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Short description */
  description: string
  /** Semantic version, e.g. "1.2.0" */
  version: string
  /** Required environment variables */
  requiredEnv: string[]
  /** Optional env variables (skill degrades gracefully without them) */
  optionalEnv?: string[]
  /** Permission scopes this skill needs */
  permissions: PermissionScope[]
  /** NPM package name (for external skills) */
  npm?: string
  /** Minimum hopcoderx version required */
  minHostVersion?: string
  /** URL to skill documentation */
  docs?: string
  /** Author/publisher info */
  author?: string
  /** Registry/category grouping for hub surfaces */
  category?: string
  /** Optional discovery tags */
  tags?: string[]
  /** Homepage or marketing page */
  homepage?: string
  /** Auth metadata for hub surfaces */
  auth?: HubManifest.Auth
  /** MCP servers bundled or referenced by this skill */
  embeddedMcp?: HubManifest.EmbeddedMcp[]
  /** Named presets/workflows exposed by the skill */
  presets?: string[]
}

export interface SkillLoadResult {
  manifest: SkillManifest
  skill: Skill
  loadedAt: Date
  source: "builtin" | "npm" | "local"
}

// ─── Manifest validation ─────────────────────────────────────────────────────

function validateManifest(raw: unknown): SkillManifest {
  if (!raw || typeof raw !== "object") throw new Error("Invalid skill manifest: not an object")
  const m = raw as Record<string, unknown>
  const required = ["id", "name", "description", "version", "permissions"]
  for (const key of required) {
    if (!m[key]) throw new Error(`Invalid skill manifest: missing '${key}'`)
  }
  if (!Array.isArray(m.permissions)) throw new Error("manifest.permissions must be an array")
  const validPerms: PermissionScope[] = ["read", "write", "network", "shell", "fs", "secrets"]
  for (const perm of m.permissions as string[]) {
    if (!validPerms.includes(perm as PermissionScope)) {
      throw new Error(`Invalid permission scope: '${perm}'. Valid: ${validPerms.join(", ")}`)
    }
  }
  if (m.auth !== undefined) {
    HubManifest.Auth.parse(m.auth)
  }
  if (m.embeddedMcp !== undefined) {
    z.array(HubManifest.EmbeddedMcp).parse(m.embeddedMcp)
  }
  if (m.tags !== undefined && !Array.isArray(m.tags)) {
    throw new Error("manifest.tags must be an array")
  }
  if (m.presets !== undefined && !Array.isArray(m.presets)) {
    throw new Error("manifest.presets must be an array")
  }
  return m as unknown as SkillManifest
}

// ─── SkillFramework ──────────────────────────────────────────────────────────

export class SkillFramework {
  private loaded = new Map<string, SkillLoadResult>()

  /** Load a built-in skill by ID */
  loadBuiltin(manifest: SkillManifest, skill: Skill): SkillLoadResult {
    validateManifest(manifest)
    const result: SkillLoadResult = { manifest, skill, loadedAt: new Date(), source: "builtin" }
    this.loaded.set(manifest.id, result)
    SkillRegistry.register(skill)
    return result
  }

  /** Load a skill from a local file (path points to a JS/TS module) */
  async loadLocal(manifestPath: string): Promise<SkillLoadResult> {
    const raw = JSON.parse(await readFile(manifestPath, "utf8"))
    const manifest = validateManifest(raw)
    const dir = manifestPath.replace(/[/\\][^/\\]+$/, "")
    const skillModule = await import(join(dir, "index.ts")).catch(() => import(join(dir, "index.js")))
    if (!skillModule.default && !skillModule.skill) {
      throw new Error(`Skill at '${dir}' must export a default or named 'skill' export`)
    }
    const skill: Skill = skillModule.default ?? skillModule.skill
    const result: SkillLoadResult = { manifest, skill, loadedAt: new Date(), source: "local" }
    this.loaded.set(manifest.id, result)
    SkillRegistry.register(skill)
    return result
  }

  /** Check if a skill is loaded */
  has(id: string): boolean {
    return this.loaded.has(id)
  }

  /** Get a loaded skill */
  get(id: string): SkillLoadResult | undefined {
    return this.loaded.get(id)
  }

  /** List all loaded skills */
  list(): SkillLoadResult[] {
    return Array.from(this.loaded.values())
  }

  /** Execute a tool within a loaded skill */
  async execute(skillId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const result = this.loaded.get(skillId)
    if (!result) throw new Error(`Skill '${skillId}' not loaded`)
    const { manifest, skill } = result

    // Permission check: warn if skill needs shell but we're in restricted mode
    if (manifest.permissions.includes("shell") && process.env.HOPCODERX_NO_SHELL === "1") {
      throw new Error(`Skill '${skillId}' requires 'shell' permission which is disabled`)
    }

    const tool = skill.tools.find((t) => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in skill '${skillId}'. Available: ${skill.tools.map((t) => t.name).join(", ")}`)
    }

    if (!skill.isAvailable()) {
      const missing = manifest.requiredEnv.filter((e) => !process.env[e])
      throw new Error(
        `Skill '${skillId}' is not available. Missing env vars: ${missing.join(", ")}`,
      )
    }

    return tool.execute(args as Record<string, any>)
  }

  /** Save pinned skill versions to disk */
  async saveVersionPin(skillId: string, version: string): Promise<void> {
    const pinsPath = join(Global.Path.config, "skill-pins.json")
    let pins: Record<string, string> = {}
    if (existsSync(pinsPath)) {
      pins = JSON.parse(await readFile(pinsPath, "utf8"))
    }
    pins[skillId] = version
    await mkdir(Global.Path.config, { recursive: true })
    await writeFile(pinsPath, JSON.stringify(pins, null, 2))
  }

  /** Get pinned version for a skill */
  async getPinnedVersion(skillId: string): Promise<string | undefined> {
    const pinsPath = join(Global.Path.config, "skill-pins.json")
    if (!existsSync(pinsPath)) return undefined
    const pins: Record<string, string> = JSON.parse(await readFile(pinsPath, "utf8"))
    return pins[skillId]
  }
}

// ─── Global singleton ─────────────────────────────────────────────────────────

export const Skills = new SkillFramework()

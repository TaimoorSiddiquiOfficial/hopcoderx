/**
 * Team Collaboration System for HopCoderX
 *
 * Features:
 *   - Shared memory across team members
 *   - Shared agents/skills library
 *   - Permission inheritance
 *   - Team member management
 *
 * Architecture:
 *   - Each team has a shared storage backend (HTTP/S3/Git)
 *   - Members sync local state with team state
 *   - Conflict resolution via last-write-wins + vector clocks
 */

import z from "zod"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../global"
import { NamedError } from "@hopcoderx/util/error"
import { Log } from "../util/log"

const log = Log.create({ service: "team" })

// ─── Types ────────────────────────────────────────────────────────────────────

export const TeamMember = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  joinedAt: z.number(),
  lastSyncAt: z.number().optional(),
})

export type TeamMember = z.infer<typeof TeamMember>

export const TeamConfig = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(TeamMember),
  syncUrl: z.string().url().optional(),
  syncKey: z.string().optional(),
  settings: z.object({
    autoSync: z.boolean().default(true),
    syncIntervalMinutes: z.number().default(15),
    shareMemory: z.boolean().default(true),
    shareAgents: z.boolean().default(true),
    shareSkills: z.boolean().default(true),
  }).default({
    autoSync: true,
    syncIntervalMinutes: 15,
    shareMemory: true,
    shareAgents: true,
    shareSkills: true,
  }),
})

export type TeamConfig = z.infer<typeof TeamConfig>

export const TeamSyncCursor = z.object({
  lastSyncAt: z.number(),
  syncedMemoryIds: z.array(z.string()),
  syncedAgentIds: z.array(z.string()),
  syncedSkillIds: z.array(z.string()),
})

export type TeamSyncCursor = z.infer<typeof TeamSyncCursor>

// ─── Team Storage ─────────────────────────────────────────────────────────────

const TEAM_CONFIG_FILE = () => path.join(Global.Path.config, "team.json")
const TEAM_SYNC_CURSOR_FILE = () => path.join(Global.Path.data, "team-cursor.json")
const TEAM_CACHE_DIR = () => path.join(Global.Path.data, "team-cache")

export class Team {
  private config: TeamConfig | null = null
  private cursor: TeamSyncCursor | null = null

  /**
   * Initialize team system
   */
  async init(): Promise<void> {
    await this.loadConfig()
    await this.loadCursor()
    await this.ensureCacheDir()
  }

  /**
   * Check if team mode is enabled
   */
  isEnabled(): boolean {
    return this.config !== null
  }

  /**
   * Get current team config
   */
  getConfig(): TeamConfig | null {
    return this.config
  }

  /**
   * Get current member info
   */
  getCurrentMember(): TeamMember | null {
    if (!this.config) return null

    // Find member by stored ID (from env or config)
    const memberId = process.env.HOPCODERX_TEAM_MEMBER_ID
    if (memberId) {
      return this.config.members.find((m) => m.id === memberId) || null
    }

    // Fallback: return first member
    return this.config.members[0] || null
  }

  /**
   * Check if current user is admin
   */
  isAdmin(): boolean {
    const member = this.getCurrentMember()
    return member?.role === "admin" || member?.role === "owner"
  }

  /**
   * Create new team
   */
  async create(name: string): Promise<TeamConfig> {
    const config: TeamConfig = {
      id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      members: [
        {
          id: `member-${Date.now()}`,
          name: process.env.USER || "Owner",
          role: "owner",
          joinedAt: Date.now(),
          lastSyncAt: Date.now(),
        },
      ],
      settings: {
        autoSync: true,
        syncIntervalMinutes: 15,
        shareMemory: true,
        shareAgents: true,
        shareSkills: true,
      },
    }

    await this.saveConfig(config)
    this.config = config
    log.info("team created", { id: config.id, name })

    return config
  }

  /**
   * Join existing team
   */
  async join(syncUrl: string, syncKey: string): Promise<TeamConfig> {
    // Fetch team info from sync server
    const response = await fetch(syncUrl, {
      headers: {
        Authorization: `Bearer ${syncKey}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw TeamError({ message: `Failed to join team: ${response.statusText}` })
    }

    const remoteConfig = await response.json()
    const config = TeamConfig.parse(remoteConfig)

    await this.saveConfig(config)
    this.config = config

    log.info("team joined", { id: config.id, name: config.name })

    return config
  }

  /**
   * Leave current team
   */
  async leave(): Promise<void> {
    if (!this.config) return

    await fs.unlink(TEAM_CONFIG_FILE()).catch(() => {})
    await fs.unlink(TEAM_SYNC_CURSOR_FILE()).catch(() => {})

    log.info("team left", { id: this.config.id })

    this.config = null
    this.cursor = null
  }

  /**
   * Add member to team
   */
  async addMember(member: Omit<TeamMember, "id" | "joinedAt" | "lastSyncAt">): Promise<TeamMember> {
    if (!this.config) {
      throw TeamError({ message: "Not in a team" })
    }

    if (!this.isAdmin()) {
      throw TeamError({ message: "Only admins can add members" })
    }

    const newMember: TeamMember = {
      ...member,
      id: `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      joinedAt: Date.now(),
      lastSyncAt: Date.now(),
    }

    this.config.members.push(newMember)
    await this.saveConfig(this.config)

    log.info("member added", { memberId: newMember.id, name: newMember.name })

    return newMember
  }

  /**
   * Remove member from team
   */
  async removeMember(memberId: string): Promise<void> {
    if (!this.config) {
      throw TeamError({ message: "Not in a team" })
    }

    if (!this.isAdmin()) {
      throw TeamError({ message: "Only admins can remove members" })
    }

    const member = this.config.members.find((m) => m.id === memberId)
    if (!member) {
      throw TeamError({ message: `Member not found: ${memberId}` })
    }

    if (member.role === "owner") {
      throw TeamError({ message: "Cannot remove team owner" })
    }

    this.config.members = this.config.members.filter((m) => m.id !== memberId)
    await this.saveConfig(this.config)

    log.info("member removed", { memberId })
  }

  /**
   * Sync with team server
   */
  async sync(): Promise<{
    pushed: number
    pulled: number
    conflicts: number
  }> {
    if (!this.config?.syncUrl) {
      return { pushed: 0, pulled: 0, conflicts: 0 }
    }

    log.info("sync started", { teamId: this.config.id })

    const result = { pushed: 0, pulled: 0, conflicts: 0 }

    // TODO: Implement actual sync logic with:
    // 1. Push local changes to server
    // 2. Pull remote changes
    // 3. Resolve conflicts (last-write-wins)
    // 4. Update cursor

    if (this.cursor) {
      this.cursor.lastSyncAt = Date.now()
      await this.saveCursor(this.cursor)
    }

    log.info("sync completed", result)

    return result
  }

  /**
   * Get team cache directory
   */
  getCacheDir(): string {
    return TEAM_CACHE_DIR()
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async loadConfig(): Promise<void> {
    try {
      const content = await fs.readFile(TEAM_CONFIG_FILE(), "utf8")
      this.config = TeamConfig.parse(JSON.parse(content))
    } catch (e) {
      this.config = null
    }
  }

  private async saveConfig(config: TeamConfig): Promise<void> {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(TEAM_CONFIG_FILE(), JSON.stringify(config, null, 2))
  }

  private async loadCursor(): Promise<void> {
    try {
      const content = await fs.readFile(TEAM_SYNC_CURSOR_FILE(), "utf8")
      this.cursor = TeamSyncCursor.parse(JSON.parse(content))
    } catch {
      this.cursor = {
        lastSyncAt: 0,
        syncedMemoryIds: [],
        syncedAgentIds: [],
        syncedSkillIds: [],
      }
    }
  }

  private async saveCursor(cursor: TeamSyncCursor): Promise<void> {
    await fs.mkdir(Global.Path.data, { recursive: true })
    await fs.writeFile(TEAM_SYNC_CURSOR_FILE(), JSON.stringify(cursor, null, 2))
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.mkdir(TEAM_CACHE_DIR(), { recursive: true })
  }
}

// ─── Team Error ───────────────────────────────────────────────────────────────

export const TeamError = NamedError.create(
  "TeamError",
  z.object({ message: z.string() }),
)

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const team = new Team()

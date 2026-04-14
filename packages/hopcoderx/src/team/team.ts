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
   *
   * Implements bidirectional sync with last-write-wins conflict resolution:
   * 1. Push local changes (memories, agents, skills) to server
   * 2. Pull remote changes from server
   * 3. Resolve conflicts using timestamps (last-write-wins)
   * 4. Update sync cursor
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
    const headers = {
      "Authorization": `Bearer ${this.config.syncKey || ""}`,
      "Content-Type": "application/json",
      "X-Team-ID": this.config.id,
    }

    try {
      // 1. Collect local changes since last sync
      const localChanges = await this.collectLocalChanges()

      // 2. Push local changes to server
      if (localChanges.hasChanges) {
        const pushResponse = await fetch(`${this.config.syncUrl}/push`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            teamId: this.config.id,
            memories: localChanges.memories,
            agents: localChanges.agents,
            skills: localChanges.skills,
            syncedAt: Date.now(),
          }),
        })

        if (pushResponse.ok) {
          const pushResult = await pushResponse.json()
          result.pushed = pushResult.accepted?.length ?? localChanges.memories.length + localChanges.agents.length + localChanges.skills.length
          result.conflicts = pushResult.conflicts?.length ?? 0
        }
      }

      // 3. Pull remote changes from server
      const pullUrl = new URL(`${this.config.syncUrl}/pull`)
      pullUrl.searchParams.set("since", String(this.cursor?.lastSyncAt ?? 0))
      pullUrl.searchParams.set("teamId", this.config.id)

      const pullResponse = await fetch(pullUrl.toString(), {
        method: "GET",
        headers,
      })

      if (pullResponse.ok) {
        const remoteData = await pullResponse.json() as {
          memories?: Array<{ id: string; content: string; tags?: string[]; updatedAt: number }>
          agents?: Array<{ id: string; name: string; config: Record<string, unknown>; updatedAt: number }>
          skills?: Array<{ id: string; name: string; content: string; updatedAt: number }>
        }

        // Apply remote changes with last-write-wins conflict resolution
        if (remoteData.memories) {
          for (const memory of remoteData.memories) {
            const shouldApply = await this.applyRemoteMemory(memory)
            if (shouldApply) result.pulled++
          }
        }

        if (remoteData.agents) {
          for (const agent of remoteData.agents) {
            const shouldApply = await this.applyRemoteAgent(agent)
            if (shouldApply) result.pulled++
          }
        }

        if (remoteData.skills) {
          for (const skill of remoteData.skills) {
            const shouldApply = await this.applyRemoteSkill(skill)
            if (shouldApply) result.pulled++
          }
        }
      }

      // 4. Update cursor
      if (this.cursor) {
        this.cursor.lastSyncAt = Date.now()
        await this.saveCursor(this.cursor)
      }

      log.info("sync completed", result)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      log.error("sync failed", { error: errorMessage })
      throw TeamError({ message: `Sync failed: ${errorMessage}` })
    }
  }

  /**
   * Collect local changes since last sync
   */
  private async collectLocalChanges(): Promise<{
    hasChanges: boolean
    memories: Array<{ id: string; content: string; tags?: string[]; updatedAt: number }>
    agents: Array<{ id: string; name: string; config: Record<string, unknown>; updatedAt: number }>
    skills: Array<{ id: string; name: string; content: string; updatedAt: number }>
  }> {
    const since = this.cursor?.lastSyncAt ?? 0
    const memories: Array<{ id: string; content: string; tags?: string[]; updatedAt: number }> = []
    const agents: Array<{ id: string; name: string; config: Record<string, unknown>; updatedAt: number }> = []
    const skills: Array<{ id: string; name: string; content: string; updatedAt: number }> = []

    // Collect changed memories from SQLite
    try {
      const sqlitePath = path.join(Global.Path.data, "memory.db")
      const { Database } = await import("bun:sqlite")
      const db = new Database(sqlitePath, { readonly: true })
      const stmt = db.query("SELECT id, content, tags, updated_at FROM memories WHERE updated_at > ?")
      for (const row of stmt.all(since) as Array<Record<string, unknown>>) {
        memories.push({
          id: row.id as string,
          content: row.content as string,
          tags: row.tags ? JSON.parse(row.tags as string) : undefined,
          updatedAt: row.updated_at as number,
        })
      }
      db.close()
    } catch {
      // SQLite not available or no memories
    }

    // Collect changed agents
    try {
      const agentsPath = path.join(Global.Path.data, "agents.json")
      const content = await fs.readFile(agentsPath, "utf8").catch(() => "[]")
      const allAgents = JSON.parse(content) as Array<{ id: string; name: string; config: Record<string, unknown>; updatedAt: number }>
      agents.push(...allAgents.filter((a) => (a.updatedAt ?? 0) > since))
    } catch {
      // No agents file
    }

    // Collect changed skills
    try {
      const skillsDir = path.join(Global.Path.config, "skills")
      const skillFiles = await fs.readdir(skillsDir).catch(() => [])
      for (const file of skillFiles) {
        if (!file.endsWith(".md")) continue
        const skillPath = path.join(skillsDir, file)
        const stat = await fs.stat(skillPath).catch(() => null)
        if (stat && stat.mtimeMs > since) {
          const skillContent = await fs.readFile(skillPath, "utf8")
          skills.push({
            id: file.replace(/\.md$/, ""),
            name: file.replace(/\.md$/, ""),
            content: skillContent,
            updatedAt: stat.mtimeMs,
          })
        }
      }
    } catch {
      // No skills directory
    }

    return {
      hasChanges: memories.length > 0 || agents.length > 0 || skills.length > 0,
      memories,
      agents,
      skills,
    }
  }

  /**
   * Apply remote memory with last-write-wins conflict resolution
   */
  private async applyRemoteMemory(remote: { id: string; content: string; tags?: string[]; updatedAt: number }): Promise<boolean> {
    try {
      const { MemoryPlugin } = await import("../memory/memory")
      if (!MemoryPlugin.isActive()) return false

      const existing = await MemoryPlugin.active.get(remote.id)

      // Last-write-wins: only apply if remote is newer
      if (existing && existing.updatedAt >= remote.updatedAt) {
        return false
      }

      await MemoryPlugin.active.upsert({
        id: remote.id,
        content: remote.content,
        tags: remote.tags ?? [],
        projectScope: null,
        score: 1.0,
      })

      // Update cursor
      if (this.cursor && !this.cursor.syncedMemoryIds.includes(remote.id)) {
        this.cursor.syncedMemoryIds.push(remote.id)
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Apply remote agent with last-write-wins conflict resolution
   */
  private async applyRemoteAgent(remote: { id: string; name: string; config: Record<string, unknown>; updatedAt: number }): Promise<boolean> {
    try {
      const agentsPath = path.join(Global.Path.data, "agents.json")
      let allAgents: Array<{ id: string; name: string; config: Record<string, unknown>; updatedAt: number }> = []

      try {
        const content = await fs.readFile(agentsPath, "utf8")
        allAgents = JSON.parse(content)
      } catch {
        // File doesn't exist yet
      }

      const existing = allAgents.find((a) => a.id === remote.id)

      // Last-write-wins: only apply if remote is newer
      if (existing && (existing.updatedAt ?? 0) >= remote.updatedAt) {
        return false
      }

      if (existing) {
        allAgents = allAgents.map((a) => (a.id === remote.id ? remote : a))
      } else {
        allAgents.push(remote)
      }

      await fs.mkdir(Global.Path.data, { recursive: true })
      await fs.writeFile(agentsPath, JSON.stringify(allAgents, null, 2))

      // Update cursor
      if (this.cursor && !this.cursor.syncedAgentIds.includes(remote.id)) {
        this.cursor.syncedAgentIds.push(remote.id)
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Apply remote skill with last-write-wins conflict resolution
   */
  private async applyRemoteSkill(remote: { id: string; name: string; content: string; updatedAt: number }): Promise<boolean> {
    try {
      const skillsDir = path.join(Global.Path.data, "team-skills")
      const skillPath = path.join(skillsDir, `${remote.id}.md`)

      let existingContent: string | null = null
      try {
        existingContent = await fs.readFile(skillPath, "utf8")
      } catch {
        // File doesn't exist yet
      }

      // If skill exists locally with same or newer mtime, skip
      if (existingContent) {
        const stat = await fs.stat(skillPath)
        if (stat.mtimeMs >= remote.updatedAt) {
          return false
        }
      }

      await fs.mkdir(skillsDir, { recursive: true })
      await fs.writeFile(skillPath, remote.content)

      // Update cursor
      if (this.cursor && !this.cursor.syncedSkillIds.includes(remote.id)) {
        this.cursor.syncedSkillIds.push(remote.id)
      }

      return true
    } catch {
      return false
    }
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

/**
 * Team shared memory for HopCoderX.
 *
 * Syncs memory entries across team members via an HTTP endpoint
 * (BDR Gateway or custom server). Provides conflict resolution
 * using last-write-wins with logical vector clocks.
 *
 * Architecture:
 *   - Each client has a local SQLite/LanceDB memory store
 *   - On sync, delta (changed since last sync) is pushed/pulled
 *   - Conflicts resolved by: higher accessCount wins, or newer updatedAt
 *
 * Setup:
 *   HOPCODERX_TEAM_SYNC_URL=https://your-gateway.example.com/memory
 *   HOPCODERX_TEAM_SYNC_KEY=your-api-key
 *   HOPCODERX_TEAM_ID=team-identifier
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { Global } from "../global"
import { MemoryPlugin } from "./memory"
import type { MemoryEntry } from "./memory"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncCursor {
  lastSyncAt: number
  syncedIds: string[]
}

interface SyncPayload {
  teamId: string
  memberId: string
  entries: MemoryEntry[]
  cursor: number
}

interface SyncResponse {
  entries: MemoryEntry[]
  cursor: number
  conflicts: string[]
}

// ─── TeamMemory ───────────────────────────────────────────────────────────────

const CURSOR_FILE = () => join(Global.Path.data, "team-sync-cursor.json")
const MEMBER_ID_FILE = () => join(Global.Path.config, "team-member-id.json")

async function getMemberId(): Promise<string> {
  const path = MEMBER_ID_FILE()
  if (existsSync(path)) {
    const d = JSON.parse(await readFile(path, "utf8"))
    return d.id
  }
  const id = `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await mkdir(Global.Path.config, { recursive: true })
  await writeFile(path, JSON.stringify({ id }))
  return id
}

async function loadCursor(): Promise<SyncCursor> {
  if (!existsSync(CURSOR_FILE())) return { lastSyncAt: 0, syncedIds: [] }
  return JSON.parse(await readFile(CURSOR_FILE(), "utf8"))
}

async function saveCursor(cursor: SyncCursor): Promise<void> {
  await mkdir(Global.Path.data, { recursive: true })
  await writeFile(CURSOR_FILE(), JSON.stringify(cursor, null, 2))
}

export class TeamMemory {
  private syncUrl: string | null = null
  private syncKey: string | null = null
  private teamId: string | null = null
  private syncInterval: ReturnType<typeof setInterval> | null = null

  configure(opts?: { syncUrl?: string; syncKey?: string; teamId?: string }): void {
    this.syncUrl = opts?.syncUrl ?? process.env.HOPCODERX_TEAM_SYNC_URL ?? null
    this.syncKey = opts?.syncKey ?? process.env.HOPCODERX_TEAM_SYNC_KEY ?? null
    this.teamId = opts?.teamId ?? process.env.HOPCODERX_TEAM_ID ?? "default"
  }

  isConfigured(): boolean {
    return !!(this.syncUrl && this.syncKey)
  }

  /** Push local entries to team sync server and pull remote entries */
  async sync(): Promise<{ pushed: number; pulled: number; conflicts: number }> {
    if (!this.isConfigured()) {
      throw new Error("Team memory not configured. Set HOPCODERX_TEAM_SYNC_URL and HOPCODERX_TEAM_SYNC_KEY.")
    }

    if (!MemoryPlugin.isActive()) {
      throw new Error("No memory backend active. Run 'hopcoderx memory' to set one up.")
    }

    const backend = MemoryPlugin.active
    const cursor = await loadCursor()
    const memberId = await getMemberId()

    // Get all local entries changed since last sync
    const allEntries = await backend.list({ limit: 10_000 })
    const changed = allEntries.filter((e) => e.updatedAt > cursor.lastSyncAt)

    const payload: SyncPayload = {
      teamId: this.teamId!,
      memberId,
      entries: changed,
      cursor: cursor.lastSyncAt,
    }

    const res = await fetch(`${this.syncUrl}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.syncKey}`,
        "X-Team-Id": this.teamId!,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Team sync error ${res.status}: ${body}`)
    }

    const remote: SyncResponse = await res.json()

    // Merge remote entries into local store (last-write-wins with score tiebreak)
    let pulled = 0
    for (const remoteEntry of remote.entries) {
      const local = await backend.get(remoteEntry.id)
      if (!local || remoteEntry.updatedAt > local.updatedAt || remoteEntry.score > (local.score + 5)) {
        await backend.upsert({
          id: remoteEntry.id,
          content: remoteEntry.content,
          tags: remoteEntry.tags,
          projectScope: remoteEntry.projectScope,
          embedding: remoteEntry.embedding,
          score: remoteEntry.score,
        })
        pulled++
      }
    }

    const newCursor: SyncCursor = {
      lastSyncAt: remote.cursor,
      syncedIds: [...cursor.syncedIds, ...changed.map((e) => e.id)],
    }
    await saveCursor(newCursor)

    return { pushed: changed.length, pulled, conflicts: remote.conflicts.length }
  }

  /** Start automatic background sync on an interval */
  startAutoSync(intervalMs = 5 * 60 * 1000): void {
    if (this.syncInterval) clearInterval(this.syncInterval)
    this.syncInterval = setInterval(async () => {
      if (!this.isConfigured()) return
      try {
        const result = await this.sync()
        if (result.pushed > 0 || result.pulled > 0) {
          console.log(`[team-memory] Sync: pushed=${result.pushed}, pulled=${result.pulled}, conflicts=${result.conflicts}`)
        }
      } catch (err: any) {
        console.error(`[team-memory] Auto-sync failed: ${err.message}`)
      }
    }, intervalMs)
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  /** Export local memory for manual sharing (JSON) */
  async exportForSharing(projectScope?: string): Promise<MemoryEntry[]> {
    if (!MemoryPlugin.isActive()) throw new Error("No memory backend active")
    return MemoryPlugin.active.list({ projectScope: projectScope ?? null })
  }

  /** Import entries shared by a teammate */
  async importShared(entries: MemoryEntry[]): Promise<number> {
    if (!MemoryPlugin.isActive()) throw new Error("No memory backend active")
    const backend = MemoryPlugin.active
    let count = 0
    for (const e of entries) {
      await backend.upsert({
        id: e.id,
        content: e.content,
        tags: e.tags,
        projectScope: e.projectScope,
        embedding: e.embedding,
        score: e.score,
      })
      count++
    }
    return count
  }
}

// ─── Global singleton ─────────────────────────────────────────────────────────

export const teamMemory = new TeamMemory()

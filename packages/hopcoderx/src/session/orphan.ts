import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."
import { Database, eq, gt, isNull, and, like } from "@/storage/db"
import { SessionTable } from "./session.sql"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "session.orphan" })

export namespace OrphanDetector {
  export const OrphanedSession = z
    .object({
      id: Identifier.schema("session"),
      sessionID: Identifier.schema("session"),
      title: z.string(),
      directory: z.string(),
      lastActivity: z.number(),
      reason: z.enum(["no_activity", "parent_deleted", "worktree_missing"]),
      age: z.number().describe("Age in milliseconds"),
    })
    .meta({
      ref: "OrphanedSession",
    })
  export type OrphanedSession = z.infer<typeof OrphanedSession>

  export const Event = {
    Detected: BusEvent.define(
      "session.orphan.detected",
      z.object({
        orphans: z.array(OrphanedSession),
      }),
    ),
    Cleaned: BusEvent.define(
      "session.orphan.cleaned",
      z.object({
        sessionID: Identifier.schema("session"),
        reason: z.string(),
      }),
    ),
  }

  /**
   * Detect orphaned sessions
   * Orphans are sessions that:
   * 1. Have no activity for a configured period (default: 7 days)
   * 2. Have a parent session that no longer exists
   * 3. Belong to a worktree that no longer exists
   */
  export const detect = fn(
    z
      .object({
        noActivityDays: z.number().optional().default(7),
        checkParentExistence: z.boolean().optional().default(true),
        checkWorktreeExistence: z.boolean().optional().default(true),
      })
      .optional(),
    async (input) => {
      const cfg = input || {}
      const noActivityMs = ((cfg.noActivityDays as number) ?? 7) * 24 * 60 * 60 * 1000
      const cutoffTime = Date.now() - noActivityMs

      const orphans: OrphanedSession[] = []

      // Find sessions with no recent activity
      if (cutoffTime > 0) {
        const inactiveSessions = Database.use((db) =>
          db
            .select()
            .from(SessionTable)
            .where(
              and(
                eq(SessionTable.project_id, Instance.project.id),
                gt(cutoffTime, SessionTable.time_updated), // time_updated < cutoffTime
              ),
            )
            .all(),
        )

        for (const row of inactiveSessions) {
          orphans.push({
            id: Identifier.ascending("session"),
            sessionID: row.id,
            title: row.title,
            directory: row.directory,
            lastActivity: row.time_updated,
            reason: "no_activity",
            age: Date.now() - row.time_updated,
          })
        }
      }

      // Find sessions with deleted parents
      if ((cfg.checkParentExistence as boolean) !== false) {
        const allSessions = Database.use((db) =>
          db
            .select({ id: SessionTable.id, parent_id: SessionTable.parent_id, title: SessionTable.title })
            .from(SessionTable)
            .where(and(eq(SessionTable.project_id, Instance.project.id), isNull(SessionTable.time_archived)))
            .all(),
        )

        const sessionIds = new Set(allSessions.map((s) => s.id))

        for (const session of allSessions) {
          if (session.parent_id && !sessionIds.has(session.parent_id)) {
            const row = Database.use((db) =>
              db
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.id, session.id))
                .get(),
            )

            if (row) {
              orphans.push({
                id: Identifier.ascending("session"),
                sessionID: row.id,
                title: row.title,
                directory: row.directory,
                lastActivity: row.time_updated,
                reason: "parent_deleted",
                age: Date.now() - row.time_updated,
              })
            }
          }
        }
      }

      // Find sessions from missing worktrees
      if ((cfg.checkWorktreeExistence as boolean) !== false) {
        // This would require filesystem checks - simplified for now
        // In a full implementation, check if session.directory still exists
      }

      if (orphans.length > 0) {
        log.warn("orphaned sessions detected", { count: orphans.length })
        Bus.publish(Event.Detected, { orphans })
      }

      return orphans
    },
  )

  /**
   * Clean up an orphaned session
   * Optionally archives instead of deleting
   */
  export const cleanup = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      delete: z.boolean().optional().default(false),
      reason: z.string().optional(),
    }),
    async (input) => {
      const session = await Session.get(input.sessionID).catch(() => null)
      if (!session) {
        log.info("session already removed", { sessionID: input.sessionID })
        return { removed: true, action: "already_gone" }
      }

      if (input.delete) {
        // Delete the session and its children
        await Session.remove(input.sessionID)
        log.info("orphaned session deleted", {
          sessionID: input.sessionID,
          reason: input.reason,
        })
      } else {
        // Archive the session
        await Session.setArchived({ sessionID: input.sessionID, time: Date.now() })
        log.info("orphaned session archived", {
          sessionID: input.sessionID,
          reason: input.reason,
        })
      }

      Bus.publish(Event.Cleaned, {
        sessionID: input.sessionID,
        reason: input.reason ?? "orphan_cleanup",
      })

      return {
        removed: true,
        action: input.delete ? "deleted" : "archived",
        session: session,
      }
    },
  )

  /**
   * Bulk cleanup of multiple orphaned sessions
   */
  export const cleanupBatch = fn(
    z.object({
      orphans: z.array(z.object({ sessionID: Identifier.schema("session") })),
      delete: z.boolean().optional().default(false),
      reason: z.string().optional(),
    }),
    async (input) => {
      const results = []
      for (const orphan of input.orphans) {
        const result = await cleanup({
          sessionID: orphan.sessionID,
          delete: input.delete,
          reason: input.reason,
        })
        results.push(result)
      }
      return results
    },
  )

  /**
   * Get statistics about orphaned sessions
   */
  export const getStats = fn(
    z
      .object({
        noActivityDays: z.number().optional().default(7),
        checkParentExistence: z.boolean().optional().default(true),
        checkWorktreeExistence: z.boolean().optional().default(false),
      })
      .optional(),
    async (input) => {
      const orphans = await detect({
        noActivityDays: input?.noActivityDays ?? 7,
        checkParentExistence: input?.checkParentExistence ?? true,
        checkWorktreeExistence: input?.checkWorktreeExistence ?? false,
      })

      const byReason = new Map<string, number>()
      const byAgeBucket = new Map<string, number>()

      for (const orphan of orphans) {
        byReason.set(orphan.reason, (byReason.get(orphan.reason) ?? 0) + 1)

        const ageDays = Math.floor(orphan.age / (24 * 60 * 60 * 1000))
        const bucket =
          ageDays < 7 ? "< 7 days" : ageDays < 30 ? "7-30 days" : ageDays < 90 ? "30-90 days" : "> 90 days"
        byAgeBucket.set(bucket, (byAgeBucket.get(bucket) ?? 0) + 1)
      }

      return {
        total: orphans.length,
        byReason: Object.fromEntries(byReason),
        byAgeBucket: Object.fromEntries(byAgeBucket),
        oldest: orphans.length > 0 ? Math.max(...orphans.map((o) => o.age)) : 0,
      }
    },
  )
}

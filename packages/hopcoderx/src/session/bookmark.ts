/**
 * Session Bookmarks — pin important messages so they survive compaction
 * and can be quickly referenced later.
 */

import z from "zod"
import { Database, eq, and } from "@/storage/db"
import { BookmarkTable, MessageTable } from "./session.sql"
import { Identifier } from "../id/id"

export namespace Bookmark {
  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    label: z.string().nullable(),
    timeCreated: z.number(),
  })
  export type Info = z.infer<typeof Info>

  /** Add a bookmark for a message. */
  export async function add(sessionID: string, messageID: string, label?: string): Promise<Info> {
    const id = Identifier.ascending("bookmark")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(BookmarkTable)
        .values({
          id,
          session_id: sessionID,
          message_id: messageID,
          label: label ?? null,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    return { id, sessionID, messageID, label: label ?? null, timeCreated: now }
  }

  /** Remove a bookmark by ID. */
  export async function remove(id: string): Promise<boolean> {
    const result = Database.use((db) => db.delete(BookmarkTable).where(eq(BookmarkTable.id, id)).run())
    return ((result as any)?.changes ?? 0) > 0
  }

  /** List all bookmarks for a session, with message preview text. */
  export async function list(sessionID: string): Promise<Array<Info & { preview: string }>> {
    const rows = Database.use((db) =>
      db
        .select({
          id: BookmarkTable.id,
          session_id: BookmarkTable.session_id,
          message_id: BookmarkTable.message_id,
          label: BookmarkTable.label,
          time_created: BookmarkTable.time_created,
          data: MessageTable.data,
        })
        .from(BookmarkTable)
        .innerJoin(MessageTable, eq(BookmarkTable.message_id, MessageTable.id))
        .where(eq(BookmarkTable.session_id, sessionID))
        .orderBy(BookmarkTable.time_created)
        .all(),
    )

    return (rows ?? []).map((row) => {
      const msg = row.data as any
      // Extract preview text from first text part
      let preview = ""
      if (msg?.parts) {
        const textPart = msg.parts.find((p: any) => p.type === "text")
        if (textPart?.text) {
          preview = textPart.text.slice(0, 120)
          if (textPart.text.length > 120) preview += "…"
        }
      }
      return {
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
        label: row.label,
        timeCreated: row.time_created ?? 0,
        preview,
      }
    })
  }

  /** Get all bookmarked message IDs for a session (used by tiering to protect from compaction). */
  export async function messageIDs(sessionID: string): Promise<Set<string>> {
    const rows = Database.use((db) =>
      db
        .select({ message_id: BookmarkTable.message_id })
        .from(BookmarkTable)
        .where(eq(BookmarkTable.session_id, sessionID))
        .all(),
    )
    return new Set((rows ?? []).map((r) => r.message_id))
  }
}

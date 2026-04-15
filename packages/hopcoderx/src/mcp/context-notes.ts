/**
 * Context Notes MCP Server
 *
 * Project-specific notes and context management.
 * Allows AI to read/write persistent project notes, meeting summaries,
 * architecture decisions, and development guidelines.
 *
 * Features:
 * - Create/read/update/delete project notes
 * - Tag-based organization
 * - Automatic context injection on session start
 * - Meeting notes with action items
 * - Architecture Decision Records (ADR)
 */

import { Log } from "@/util/log"
import { readFile, writeFile, mkdir, readdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "mcp.context-notes" })

export namespace ContextNotesMCP {
  export interface Note {
    id: string
    title: string
    content: string
    tags: string[]
    createdAt: number
    updatedAt: number
    type: "general" | "meeting" | "adr" | "guideline" | "todo"
    metadata?: Record<string, any>
  }

  const NOTES_DIR = ".hopcoderx/notes"

  function getNotesDir(): string {
    return join(Instance.directory, NOTES_DIR)
  }

  function getNotePath(id: string): string {
    return join(getNotesDir(), `${id}.md`)
  }

  /**
   * Initialize the context notes server
   */
  export async function init(): Promise<void> {
    const notesDir = getNotesDir()
    if (!existsSync(notesDir)) {
      await mkdir(notesDir, { recursive: true })
      log.info("notes directory created", { path: notesDir })
    }
  }

  /**
   * Create a new note
   */
  export async function createNote(input: {
    title: string
    content: string
    tags?: string[]
    type?: Note["type"]
    metadata?: Record<string, any>
  }): Promise<Note> {
    const note: Note = {
      id: Identifier.ascending("message"),
      title: input.title,
      content: input.content,
      tags: input.tags || [],
      type: input.type || "general",
      metadata: input.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveNote(note)
    log.info("note created", { id: note.id, title: note.title })
    return note
  }

  /**
   * Get a note by ID
   */
  export async function getNote(id: string): Promise<Note | null> {
    const notePath = getNotePath(id)
    if (!existsSync(notePath)) return null

    const content = await readFile(notePath, "utf-8")
    return parseNoteFile(id, content)
  }

  /**
   * Update an existing note
   */
  export async function updateNote(id: string, updates: Partial<Note>): Promise<Note | null> {
    const note = await getNote(id)
    if (!note) return null

    const updated: Note = {
      ...note,
      ...updates,
      id: note.id,
      title: updates.title ?? note.title,
      content: updates.content ?? note.content,
      tags: updates.tags ?? note.tags,
      type: updates.type ?? note.type,
      updatedAt: Date.now(),
    }

    await saveNote(updated)
    log.info("note updated", { id, title: updated.title })
    return updated
  }

  /**
   * Delete a note
   */
  export async function deleteNote(id: string): Promise<boolean> {
    const notePath = getNotePath(id)
    if (!existsSync(notePath)) return false

    await Bun.write(notePath, "") // Truncate file
    const { unlink } = await import("fs/promises")
    await unlink(notePath)
    log.info("note deleted", { id })
    return true
  }

  /**
   * List all notes, optionally filtered by tag or type
   */
  export async function listNotes(filter?: { tag?: string; type?: Note["type"] }): Promise<Note[]> {
    const notesDir = getNotesDir()
    if (!existsSync(notesDir)) return []

    const notes: Note[] = []
    const files = await readdir(notesDir)

    for (const file of files) {
      if (!file.endsWith(".md")) continue

      const id = file.replace(".md", "")
      const note = await getNote(id)
      if (!note) continue

      if (filter?.tag && !note.tags.includes(filter.tag)) continue
      if (filter?.type && note.type !== filter.type) continue

      notes.push(note)
    }

    // Sort by updated date, newest first
    notes.sort((a, b) => b.updatedAt - a.updatedAt)
    return notes
  }

  /**
   * Search notes by content
   */
  export async function searchNotes(query: string): Promise<Note[]> {
    const notes = await listNotes()
    const queryLower = query.toLowerCase()

    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(queryLower) ||
        note.content.toLowerCase().includes(queryLower) ||
        note.tags.some((tag) => tag.toLowerCase().includes(queryLower)),
    )
  }

  /**
   * Create a meeting note with action items
   */
  export async function createMeetingNote(input: {
    title: string
    date: string
    attendees: string[]
    summary: string
    actionItems: Array<{ task: string; assignee?: string; dueDate?: string }>
    tags?: string[]
  }): Promise<Note> {
    const content = [
      `# ${input.title}`,
      ``,
      `**Date:** ${input.date}`,
      `**Attendees:** ${input.attendees.join(", ")}`,
      ``,
      `## Summary`,
      input.summary,
      ``,
      `## Action Items`,
      ...input.actionItems.map(
        (item, i) => `- [ ] ${item.task}${item.assignee ? ` (@${item.assignee})` : ""}${item.dueDate ? ` (Due: ${item.dueDate})` : ""}`,
      ),
    ].join("\n")

    return createNote({
      title: input.title,
      content,
      tags: [...(input.tags || []), "meeting"],
      type: "meeting",
      metadata: {
        date: input.date,
        attendees: input.attendees,
        actionItems: input.actionItems,
      },
    })
  }

  /**
   * Create an Architecture Decision Record (ADR)
   */
  export async function createADR(input: {
    title: string
    status: "proposed" | "accepted" | "rejected" | "deprecated"
    context: string
    decision: string
    consequences: string[]
    tags?: string[]
  }): Promise<Note> {
    const content = [
      `# ${input.title}`,
      ``,
      `**Status:** ${input.status.toUpperCase()}`,
      ``,
      `## Context`,
      input.context,
      ``,
      `## Decision`,
      input.decision,
      ``,
      `## Consequences`,
      ...input.consequences.map((c) => `- ${c}`),
    ].join("\n")

    return createNote({
      title: input.title,
      content,
      tags: [...(input.tags || []), "adr", "architecture"],
      type: "adr",
      metadata: {
        status: input.status,
      },
    })
  }

  /**
   * Get notes directory path
   */
  export function getDirectory(): string {
    return getNotesDir()
  }

  /**
   * Save note to file
   */
  async function saveNote(note: Note): Promise<void> {
    const notePath = getNotePath(note.id)
    const frontmatter = [
      "---",
      `id: ${note.id}`,
      `title: ${note.title}`,
      `type: ${note.type}`,
      `tags: [${note.tags.join(", ")}]`,
      `createdAt: ${new Date(note.createdAt).toISOString()}`,
      `updatedAt: ${new Date(note.updatedAt).toISOString()}`,
      "---",
      "",
    ].join("\n")

    await writeFile(notePath, frontmatter + note.content)
  }

  /**
   * Parse note from file
   */
  function parseNoteFile(id: string, content: string): Note | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) {
      // No frontmatter, treat entire content as the note
      return {
        id,
        title: "Untitled Note",
        content: content.trim(),
        tags: [],
        type: "general",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }

    const [, frontmatter, body] = frontmatterMatch
    const metadata: Record<string, any> = {}

    for (const line of frontmatter.split("\n")) {
      const [key, ...valueParts] = line.split(": ")
      const value = valueParts.join(": ").trim()
      if (key && value) {
        // Parse arrays
        if (value.startsWith("[") && value.endsWith("]")) {
          metadata[key] = value.slice(1, -1).split(",").map((s) => s.trim())
        } else if (value.match(/^\d+$/)) {
          metadata[key] = parseInt(value, 10)
        } else {
          metadata[key] = value
        }
      }
    }

    return {
      id,
      title: metadata.title || "Untitled Note",
      content: body.trim(),
      tags: metadata.tags || [],
      type: (metadata.type as Note["type"]) || "general",
      createdAt: metadata.createdAt ? new Date(metadata.createdAt).getTime() : Date.now(),
      updatedAt: metadata.updatedAt ? new Date(metadata.updatedAt).getTime() : Date.now(),
      metadata,
    }
  }

  /**
   * MCP Tools export
   */
  export const tools = {
    create_note: {
      description: "Create a new project note with title, content, and optional tags",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title" },
          content: { type: "string", description: "Note content" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
          type: { type: "string", enum: ["general", "meeting", "adr", "guideline", "todo"], description: "Note type" },
        },
        required: ["title", "content"],
      },
      execute: async (args: Record<string, any>) => {
        const note = await createNote({
          title: args.title,
          content: args.content,
          tags: args.tags,
          type: args.type,
        })
        return `Note created: ${note.id} - ${note.title}`
      },
    },

    get_note: {
      description: "Get a specific note by ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID" },
        },
        required: ["id"],
      },
      execute: async (args: Record<string, any>) => {
        const note = await getNote(args.id)
        if (!note) return "Note not found"
        return `# ${note.title}\n\n${note.content}`
      },
    },

    list_notes: {
      description: "List all notes, optionally filtered by tag or type",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Filter by tag" },
          type: { type: "string", enum: ["general", "meeting", "adr", "guideline", "todo"], description: "Filter by type" },
        },
      },
      execute: async (args: Record<string, any>) => {
        const notes = await listNotes({ tag: args.tag, type: args.type })
        if (notes.length === 0) return "No notes found"
        return notes.map((n) => `- [${n.type}] ${n.title} (${n.tags.join(", ")})`).join("\n")
      },
    },

    search_notes: {
      description: "Search notes by content",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: async (args: Record<string, any>) => {
        const notes = await searchNotes(args.query)
        if (notes.length === 0) return "No notes found matching query"
        return notes.map((n) => `- [${n.type}] ${n.title} (${n.tags.join(", ")})`).join("\n")
      },
    },

    update_note: {
      description: "Update an existing note",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID" },
          title: { type: "string", description: "New title" },
          content: { type: "string", description: "New content" },
          tags: { type: "array", items: { type: "string" }, description: "New tags" },
        },
        required: ["id"],
      },
      execute: async (args: Record<string, any>) => {
        const note = await updateNote(args.id, {
          title: args.title,
          content: args.content,
          tags: args.tags,
        })
        if (!note) return "Note not found"
        return `Note updated: ${note.id} - ${note.title}`
      },
    },

    delete_note: {
      description: "Delete a note",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID" },
        },
        required: ["id"],
      },
      execute: async (args: Record<string, any>) => {
        const deleted = await deleteNote(args.id)
        return deleted ? `Note deleted: ${args.id}` : "Note not found"
      },
    },

    create_meeting_note: {
      description: "Create a meeting note with action items",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Meeting title" },
          date: { type: "string", description: "Meeting date" },
          attendees: { type: "array", items: { type: "string" }, description: "List of attendees" },
          summary: { type: "string", description: "Meeting summary" },
          actionItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task: { type: "string" },
                assignee: { type: "string" },
                dueDate: { type: "string" },
              },
            },
            description: "Action items from the meeting",
          },
        },
        required: ["title", "date", "attendees", "summary", "actionItems"],
      },
      execute: async (args: Record<string, any>) => {
        const note = await createMeetingNote({
          title: args.title,
          date: args.date,
          attendees: args.attendees,
          summary: args.summary,
          actionItems: args.actionItems,
        })
        return `Meeting note created: ${note.id} - ${note.title}`
      },
    },

    create_adr: {
      description: "Create an Architecture Decision Record (ADR)",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "ADR title" },
          status: { type: "string", enum: ["proposed", "accepted", "rejected", "deprecated"], description: "Decision status" },
          context: { type: "string", description: "Context and problem statement" },
          decision: { type: "string", description: "The decision made" },
          consequences: { type: "array", items: { type: "string" }, description: "Consequences of the decision" },
        },
        required: ["title", "status", "context", "decision", "consequences"],
      },
      execute: async (args: Record<string, any>) => {
        const note = await createADR({
          title: args.title,
          status: args.status,
          context: args.context,
          decision: args.decision,
          consequences: args.consequences,
        })
        return `ADR created: ${note.id} - ${note.title}`
      },
    },
  }
}

import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."
import { Identifier } from "@/id/id"
import { Todo } from "./todo"
import { MessageV2 } from "./message-v2"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"

const log = Log.create({ service: "session.handoff" })

export namespace SessionHandoff {
  export const HandoffPrompt = z
    .object({
      id: Identifier.schema("handoff"),
      sessionID: Identifier.schema("session"),
      summary: z.string().describe("Brief summary of what was accomplished"),
      todos: z
        .array(
          z.object({
            content: z.string(),
            status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
            priority: z.enum(["high", "medium", "low"]),
          }),
        )
        .describe("Remaining todos to continue with"),
      context: z
        .array(z.string())
        .optional()
        .describe("Key context files or information for the next session"),
      createdAt: z.number(),
    })
    .meta({
      ref: "HandoffPrompt",
    })
  export type HandoffPrompt = z.infer<typeof HandoffPrompt>

  export const Event = {
    Created: BusEvent.define(
      "session.handoff.created",
      z.object({
        handoff: HandoffPrompt,
      }),
    ),
  }

  /**
   * Create a handoff prompt for session continuation
   * Used when transferring work from one session to another
   */
  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      summary: z.string(),
      todos: z.array(
        z.object({
          content: z.string(),
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
          priority: z.enum(["high", "medium", "low"]),
        }),
      ),
      context: z.array(z.string()).optional(),
    }),
    async (input) => {
      const handoff: HandoffPrompt = {
        id: Identifier.ascending("handoff"),
        sessionID: input.sessionID,
        summary: input.summary,
        todos: input.todos,
        context: input.context,
        createdAt: Date.now(),
      }

      log.info("handoff created", {
        sessionID: input.sessionID,
        handoffID: handoff.id,
        todoCount: handoff.todos.length,
      })

      Bus.publish(Event.Created, { handoff })
      return handoff
    },
  )

  /**
   * Resume a session from a handoff prompt
   * Creates a new child session with the handoff context
   */
  export const resume = fn(
    z.object({
      handoff: HandoffPrompt,
      title: z.string().optional(),
    }),
    async (input) => {
      const pendingTodos = input.handoff.todos.filter((t) => t.status === "pending" || t.status === "in_progress")

      // Create child session
      const childSession = await Session.createNext({
        parentID: input.handoff.sessionID,
        directory: (await Session.get(input.handoff.sessionID)).directory,
        title: input.title ?? `Continued: ${input.handoff.summary.slice(0, 50)}`,
      })

      // Create initial user message with handoff context
      const handoffMessage = await buildHandoffMessage(input.handoff, childSession.id)

      log.info("session resumed from handoff", {
        originalSessionID: input.handoff.sessionID,
        newSessionID: childSession.id,
        handoffID: input.handoff.id,
      })

      return {
        session: childSession,
        handoffMessage,
        pendingTodos,
      }
    },
  )

  /**
   * Build a user message that introduces the handoff context
   */
  async function buildHandoffMessage(handoff: HandoffPrompt, newSessionID: string) {
    const contextLines: string[] = []

    contextLines.push(`## Session Continuation`)
    contextLines.push(``)
    contextLines.push(`This session continues from a previous handoff.`)
    contextLines.push(``)
    contextLines.push(`### Summary`)
    contextLines.push(handoff.summary)
    contextLines.push(``)

    if (handoff.context && handoff.context.length > 0) {
      contextLines.push(`### Context Files`)
      for (const file of handoff.context) {
        contextLines.push(`- ${file}`)
      }
      contextLines.push(``)
    }

    const pendingTodos = handoff.todos.filter((t) => t.status === "pending" || t.status === "in_progress")
    if (pendingTodos.length > 0) {
      contextLines.push(`### Remaining Tasks`)
      for (const todo of pendingTodos) {
        const priorityIcon = todo.priority === "high" ? "🔴" : todo.priority === "medium" ? "🟡" : "🟢"
        contextLines.push(`- ${priorityIcon} [${todo.status}] ${todo.content}`)
      }
      contextLines.push(``)
    }

    contextLines.push(`Please review the context above and continue with the remaining tasks.`)

    const message: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: newSessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "system", modelID: "handoff" },
      summary: undefined,
      variant: "handoff",
    }

    await Session.updateMessage(message)

    const textPart: MessageV2.TextPart = {
      id: Identifier.ascending("part"),
      messageID: message.id,
      sessionID: newSessionID,
      type: "text",
      text: contextLines.join("\n"),
      time: { start: Date.now(), end: Date.now() },
    }

    await Session.updatePart(textPart)

    // Update todos for new session
    if (pendingTodos.length > 0) {
      Todo.update({
        sessionID: newSessionID,
        todos: pendingTodos.map((t) => ({
          content: t.content,
          status: t.status === "in_progress" ? "pending" : t.status,
          priority: t.priority,
        })),
      })
    }

    return {
      message,
      textPart,
    }
  }

  /**
   * Generate a handoff prompt from the current session state
   * Analyzes recent messages and todos to create a summary
   */
  export const generate = fn(
    z.object({
      sessionID: Identifier.schema("session"),
    }),
    async (input) => {
      const session = await Session.get(input.sessionID)
      const messages = await Session.messages({ sessionID: input.sessionID })
      const todos = Todo.get(input.sessionID)

      // Get last few assistant messages to understand what was done
      const recentAssistantMessages = messages
        .filter((m) => m.info.role === "assistant" && !m.info.error)
        .slice(-3)

      // Build summary from recent activity
      const summaryParts: string[] = []

      for (const msg of recentAssistantMessages) {
        const textParts = msg.parts.filter((p) => p.type === "text")
        for (const part of textParts) {
          if (part.text.length > 200) {
            summaryParts.push(part.text.slice(0, 200) + "...")
          } else {
            summaryParts.push(part.text)
          }
        }
      }

      const summary =
        summaryParts.length > 0
          ? `Recent activity: ${summaryParts.join(" | ")}`
          : `Session ${session.id} - ${session.title}`

      const handoff: HandoffPrompt = {
        id: Identifier.ascending("handoff"),
        sessionID: input.sessionID,
        summary,
        todos: todos.map((t) => ({
          content: t.content,
          status: t.status as "pending" | "in_progress" | "completed" | "cancelled",
          priority: t.priority as "high" | "medium" | "low",
        })),
        context: [],
        createdAt: Date.now(),
      }

      return handoff
    },
  )
}

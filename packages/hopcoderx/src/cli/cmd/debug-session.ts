/**
 * hopcoderx debug session — Interactive session debugger
 *
 * Usage:
 *   hopcoderx debug session <id>    Debug a specific session
 *   hopcoderx debug sessions        List recent sessions
 *   hopcoderx debug trace <id>      Show execution trace
 *   hopcoderx debug replay <id>     Replay session step-by-step
 *
 * Features:
 *   - Step through agent execution
 *   - Inspect tool calls and responses
 *   - View token usage and costs
 *   - Export debug bundles
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../../global"
import type { Argv } from "yargs"

const SESSIONS_DIR = () => path.join(Global.Path.data, "sessions")

interface SessionMeta {
  id: string
  createdAt: number
  updatedAt: number
  agent: string
  messageCount: number
  tokenUsage: { input: number; output: number }
  cost: number
  status: "active" | "completed" | "error"
}

async function listSessions(): Promise<SessionMeta[]> {
  const dir = SESSIONS_DIR()
  try {
    const files = await fs.readdir(dir)
    const sessions: SessionMeta[] = []

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const content = await fs.readFile(path.join(dir, file), "utf8")
        const data = JSON.parse(content)
        sessions.push({
          id: data.id || file.replace(".json", ""),
          createdAt: data.createdAt || 0,
          updatedAt: data.updatedAt || 0,
          agent: data.agent || "build",
          messageCount: data.messages?.length || 0,
          tokenUsage: data.tokenUsage || { input: 0, output: 0 },
          cost: data.cost || 0,
          status: data.status || "completed",
        })
      } catch {
        // Skip corrupted files
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

async function loadSession(id: string): Promise<any | null> {
  try {
    const filePath = path.join(SESSIONS_DIR(), `${id}.json`)
    const content = await fs.readFile(filePath, "utf8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

function formatTokens(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `${(cost * 100).toFixed(1)}¢`
  return `${(cost * 1000).toFixed(1)}m¢`
}

function statusIcon(status: string): string {
  switch (status) {
    case "active":
      return UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL
    case "completed":
      return UI.Style.TEXT_DIM + "○" + UI.Style.TEXT_NORMAL
    case "error":
      return UI.Style.TEXT_DANGER + "✕" + UI.Style.TEXT_NORMAL
    default:
      return "○"
  }
}

// ─── Debug Session Interactive ───────────────────────────────────────────────

async function debugSessionInteractive(session: any): Promise<void> {
  const messages = session.messages || []

  UI.println("\n" + UI.Style.TEXT_INFO_BOLD + `Session: ${session.id}` + UI.Style.TEXT_NORMAL)
  UI.println(UI.Style.TEXT_DIM + `Agent: ${session.agent} | Messages: ${messages.length} | Status: ${session.status}` + UI.Style.TEXT_NORMAL)
  UI.println()

  let currentIndex = 0

  const showMenu = () => {
    UI.println()
    UI.println(UI.Style.TEXT_INFO_BOLD + "Debug Controls:" + UI.Style.TEXT_NORMAL)
    UI.println("  [n]ext     - Next message/tool call")
    UI.println("  [p]rev     - Previous message")
    UI.println("  [j]ump     - Jump to specific index")
    UI.println("  [i]nspect  - Inspect current message in detail")
    UI.println("  [t]okens   - Show token usage breakdown")
    UI.println("  [e]xport   - Export session bundle")
    UI.println("  [q]uit     - Exit debugger")
    UI.println()
  }

  const showMessage = (index: number) => {
    if (index < 0 || index >= messages.length) {
      UI.println(UI.Style.TEXT_DIM + "(No message)" + UI.Style.TEXT_NORMAL)
      return
    }

    const msg = messages[index]
    const role = msg.role || "unknown"
    const roleIcon = role === "user" ? "👤" : role === "assistant" ? "🤖" : "⚙"

    UI.println()
    UI.println(UI.Style.TEXT_INFO_BOLD + `Message ${index + 1}/${messages.length}` + UI.Style.TEXT_NORMAL)
    UI.println(UI.Style.TEXT_DIM + `${roleIcon} ${role}` + UI.Style.TEXT_NORMAL)

    if (msg.content) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)
      const preview = content.slice(0, 500)
      UI.println(preview + (content.length > 500 ? UI.Style.TEXT_DIM + "... (truncated)" + UI.Style.TEXT_NORMAL : ""))
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      UI.println()
      UI.println(UI.Style.TEXT_WARNING_BOLD + `Tool Calls (${msg.toolCalls.length}):` + UI.Style.TEXT_NORMAL)
      for (const tool of msg.toolCalls) {
        UI.println(`  ${UI.Style.TEXT_SUCCESS}►${UI.Style.TEXT_NORMAL} ${tool.toolName || tool.name}`)
        if (tool.arguments) {
          const args = typeof tool.arguments === "string" ? tool.arguments : JSON.stringify(tool.arguments, null, 2)
          UI.println(UI.Style.TEXT_DIM + `    ${args.slice(0, 200)}${args.length > 200 ? "..." : ""}` + UI.Style.TEXT_NORMAL)
        }
      }
    }

    if (msg.toolResults && msg.toolResults.length > 0) {
      UI.println()
      UI.println(UI.Style.TEXT_INFO_BOLD + `Tool Results (${msg.toolResults.length}):` + UI.Style.TEXT_NORMAL)
      for (const result of msg.toolResults) {
        const output = result.output || result.result
        const preview = typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200)
        UI.println(`  ${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} ${result.toolName || result.name}: ${preview}`)
      }
    }
  }

  showMenu()
  showMessage(currentIndex)

  // Interactive loop using prompts
  while (true) {
    const choice = await prompts.text({
      message: "Command (n/p/j/i/t/e/q)",
      placeholder: "n",
    })

    if (prompts.isCancel(choice)) {
      prompts.outro("Exited debugger")
      return
    }

    const cmd = (choice || "n").toLowerCase().charAt(0)

    switch (cmd) {
      case "n": // Next
        if (currentIndex < messages.length - 1) {
          currentIndex++
          showMessage(currentIndex)
        } else {
          UI.println(UI.Style.TEXT_DIM + "Already at last message" + UI.Style.TEXT_NORMAL)
        }
        break

      case "p": // Previous
        if (currentIndex > 0) {
          currentIndex--
          showMessage(currentIndex)
        } else {
          UI.println(UI.Style.TEXT_DIM + "Already at first message" + UI.Style.TEXT_NORMAL)
        }
        break

      case "j": { // Jump
        const jumpTo = await prompts.text({
          message: `Jump to message (1-${messages.length})`,
          placeholder: String(currentIndex + 1),
        })
        if (!prompts.isCancel(jumpTo)) {
          const idx = parseInt(jumpTo) - 1
          if (idx >= 0 && idx < messages.length) {
            currentIndex = idx
            showMessage(currentIndex)
          } else {
            UI.println(UI.Style.TEXT_WARNING + "Invalid index" + UI.Style.TEXT_NORMAL)
          }
        }
        break
      }

      case "i": // Inspect
        if (messages[currentIndex]) {
          UI.println()
          UI.println(UI.Style.TEXT_INFO_BOLD + "Full Message JSON:" + UI.Style.TEXT_NORMAL)
          UI.println(JSON.stringify(messages[currentIndex], null, 2).slice(0, 2000))
          if (JSON.stringify(messages[currentIndex]).length > 2000) {
            UI.println(UI.Style.TEXT_DIM + "... (truncated)" + UI.Style.TEXT_NORMAL)
          }
        }
        break

      case "t": // Tokens
        UI.println()
        UI.println(UI.Style.TEXT_INFO_BOLD + "Token Usage:" + UI.Style.TEXT_NORMAL)
        if (session.tokenUsage) {
          UI.println(`  Input:  ${formatTokens(session.tokenUsage.input || 0)} tokens`)
          UI.println(`  Output: ${formatTokens(session.tokenUsage.output || 0)} tokens`)
          UI.println(`  Total:  ${formatTokens((session.tokenUsage.input || 0) + (session.tokenUsage.output || 0))} tokens`)
        }
        if (session.cost !== undefined) {
          UI.println(`  Cost:   ${formatCost(session.cost)}`)
        }
        break

      case "e": // Export
        const exportPath = path.join(process.cwd(), `session-${session.id}-debug.json`)
        await fs.writeFile(exportPath, JSON.stringify(session, null, 2))
        UI.println(UI.Style.TEXT_SUCCESS + `Exported to: ${exportPath}` + UI.Style.TEXT_NORMAL)
        break

      case "q": // Quit
        prompts.outro("Exited debugger")
        return

      default:
        showMenu()
    }
  }
}

// ─── CLI Command ──────────────────────────────────────────────────────────────

export const DebugSessionCommand = cmd({
  command: "debug session [id]",
  describe: "Interactively debug a session",
  builder: (yargs: Argv) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "Session ID to debug",
      })
      .option("list", {
        type: "boolean",
        describe: "List recent sessions",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Session Debugger")

    // List sessions if requested or no ID provided
    if (args.list || !args.id) {
      const sessions = await listSessions()

      if (sessions.length === 0) {
        prompts.log.info("No sessions found")
        prompts.log.info("Start a session with: hopcoderx run <prompt>")
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Found ${sessions.length} session(s):\n`)

      for (const s of sessions.slice(0, 10)) {
        const date = new Date(s.updatedAt).toLocaleString()
        const tokens = formatTokens((s.tokenUsage.input || 0) + (s.tokenUsage.output || 0))
        prompts.log.info(`  ${statusIcon(s.status)} ${s.id.slice(0, 8)}  ${s.agent}  ${s.messageCount} msgs  ${tokens} tok  ${date}`)
      }

      if (sessions.length > 10) {
        prompts.log.info(`\n  ... and ${sessions.length - 10} more`)
      }

      // Select session to debug
      const selected = await prompts.select({
        message: "Select session to debug",
        options: sessions.slice(0, 10).map((s) => ({
          label: `${s.id.slice(0, 8)} - ${s.agent} - ${s.messageCount} msgs`,
          value: s.id,
          hint: new Date(s.updatedAt).toLocaleString(),
        })),
      })

      if (prompts.isCancel(selected)) {
        prompts.outro("Cancelled")
        return
      }

      args.id = selected
    }

    // Load and debug session
    const session = await loadSession(args.id as string)
    if (!session) {
      prompts.log.error(`Session not found: ${args.id}`)
      prompts.outro("Failed")
      process.exit(1)
    }

    await debugSessionInteractive(session)
  },
})

// ─── Debug Trace Command ─────────────────────────────────────────────────────

export const DebugTraceCommand = cmd({
  command: "trace <id>",
  describe: "Show execution trace for a session",
  async handler(args) {
    UI.empty()
    prompts.intro("Execution Trace")

    const session = await loadSession(args.id as string)
    if (!session) {
      prompts.log.error(`Session not found: ${args.id}`)
      prompts.outro("Failed")
      process.exit(1)
    }

    const messages = session.messages || []

    prompts.log.info(`Session: ${session.id}\n`)

    let stepNum = 0
    for (const msg of messages) {
      stepNum++

      if (msg.role === "user") {
        UI.println(`\n${UI.Style.TEXT_INFO_BOLD}Step ${stepNum}: User Input${UI.Style.TEXT_NORMAL}`)
        const content = typeof msg.content === "string" ? msg.content : "[complex message]"
        UI.println(UI.Style.TEXT_DIM + content.slice(0, 100) + (content.length > 100 ? "..." : "") + UI.Style.TEXT_NORMAL)
      }

      if (msg.role === "assistant") {
        UI.println(`\n${UI.Style.TEXT_SUCCESS_BOLD}Step ${stepNum}: Assistant${UI.Style.TEXT_NORMAL}`)

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tool of msg.toolCalls) {
            UI.println(`  ${UI.Style.TEXT_WARNING}►${UI.Style.TEXT_NORMAL} Tool: ${tool.toolName || tool.name}`)
          }
        }

        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const result of msg.toolResults) {
            UI.println(`  ${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} Result: ${result.toolName || result.name}`)
          }
        }
      }
    }

    UI.println()
    UI.println(UI.Style.TEXT_DIM + `Total steps: ${stepNum}` + UI.Style.TEXT_NORMAL)

    prompts.outro("Done")
  },
})

// ─── Debug Replay Command ────────────────────────────────────────────────────

export const DebugReplayCommand = cmd({
  command: "replay <id>",
  describe: "Replay session step-by-step",
  async handler(args) {
    UI.empty()
    prompts.intro("Session Replay")

    const session = await loadSession(args.id as string)
    if (!session) {
      prompts.log.error(`Session not found: ${args.id}`)
      prompts.outro("Failed")
      process.exit(1)
    }

    const messages = session.messages || []

    prompts.log.info(`Replaying session: ${session.id}`)
    prompts.log.info(`Press Enter to advance, 'q' to quit\n`)

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const role = msg.role || "unknown"

      UI.println()
      UI.println(UI.Style.TEXT_DIM + `--- Step ${i + 1}/${messages.length} ---` + UI.Style.TEXT_NORMAL)

      if (role === "user") {
        UI.println(UI.Style.TEXT_INFO + "👤 User:" + UI.Style.TEXT_NORMAL)
        const content = typeof msg.content === "string" ? msg.content : "[complex message]"
        UI.println(content.slice(0, 300) + (content.length > 300 ? "..." : ""))
      } else if (role === "assistant") {
        UI.println(UI.Style.TEXT_SUCCESS + "🤖 Assistant:" + UI.Style.TEXT_NORMAL)

        if (msg.toolCalls) {
          for (const tool of msg.toolCalls) {
            UI.println(UI.Style.TEXT_WARNING + `  ► ${tool.toolName || tool.name}` + UI.Style.TEXT_NORMAL)
          }
        }
      }

      const input = await prompts.text({
        message: "Enter to continue, 'q' to quit",
        placeholder: "",
      })

      if (input === "q" || prompts.isCancel(input)) {
        prompts.outro("Exited replay")
        return
      }
    }

    prompts.outro("Replay complete")
  },
})

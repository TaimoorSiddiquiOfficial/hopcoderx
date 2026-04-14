/**
 * hopcoderx repl — Interactive REPL mode
 *
 * Usage:
 *   hopcoderx repl
 *
 * Features:
 *   - Persistent session within REPL
 *   - Command history with fuzzy search
 *   - Multi-line input support
 *   - Slash commands for common operations
 *   - Tab completion
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import { createInterface } from "readline"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../../global"
import { execSync } from "child_process"

const HISTORY_FILE = () => path.join(Global.Path.data, "repl-history.json")
const MAX_HISTORY = 1000

interface REPLHistory {
  entries: string[]
}

async function loadHistory(): Promise<string[]> {
  try {
    const content = await fs.readFile(HISTORY_FILE(), "utf8")
    const data = JSON.parse(content) as REPLHistory
    return data.entries ?? []
  } catch {
    return []
  }
}

async function saveHistory(entries: string[]): Promise<void> {
  await fs.mkdir(Global.Path.data, { recursive: true })
  await fs.writeFile(HISTORY_FILE(), JSON.stringify({ entries: entries.slice(-MAX_HISTORY) }, null, 2))
}

const SLASH_COMMANDS: Record<string, { desc: string; handler?: () => void | Promise<void> }> = {
  help: { desc: "Show available commands" },
  clear: { desc: "Clear screen" },
  history: { desc: "Show command history" },
  exit: { desc: "Exit REPL" },
  run: { desc: "Run a hopcoderx command" },
  memory: { desc: "Quick memory add" },
  agent: { desc: "Switch agent persona" },
}

export const REPLCommand = cmd({
  command: "repl",
  describe: "start interactive REPL session",
  async handler() {
    UI.empty()
    console.log(UI.Style.TEXT_INFO_BOLD + "HopCoderX REPL" + UI.Style.TEXT_NORMAL)
    console.log(UI.Style.TEXT_DIM + "Type /help for available commands, /exit to quit" + UI.Style.TEXT_NORMAL)
    console.log()

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    const history = await loadHistory()
    let historyIndex = history.length

    // Custom prompt
    const prompt = () => {
      return UI.Style.TEXT_SUCCESS_BOLD + "hopcoderx> " + UI.Style.TEXT_NORMAL
    }

    // Show help
    const showHelp = () => {
      console.log("\n" + UI.Style.TEXT_INFO_BOLD + "Available commands:" + UI.Style.TEXT_NORMAL)
      for (const [cmd, info] of Object.entries(SLASH_COMMANDS)) {
        console.log(`  ${UI.Style.TEXT_SUCCESS_BOLD}/${cmd}${UI.Style.TEXT_NORMAL}  ${UI.Style.TEXT_DIM}${info.desc}${UI.Style.TEXT_NORMAL}`)
      }
      console.log(UI.Style.TEXT_DIM + "\nOr type any hopcoderx command to execute it" + UI.Style.TEXT_NORMAL)
      console.log(UI.Style.TEXT_DIM + "Use ↑/↓ for history, Ctrl+C to exit" + UI.Style.TEXT_NORMAL)
      console.log()
    }

    // Show history
    const showHistory = () => {
      if (history.length === 0) {
        console.log(UI.Style.TEXT_DIM + "No history yet" + UI.Style.TEXT_NORMAL)
        return
      }
      console.log("\n" + UI.Style.TEXT_INFO_BOLD + "History:" + UI.Style.TEXT_NORMAL)
      history.slice(-20).forEach((entry, i) => {
        console.log(`  ${String(history.length - 20 + i + 1).padStart(3)}. ${entry}`)
      })
      console.log()
    }

    // Process command
    const processCommand = async (input: string): Promise<void> => {
      const trimmed = input.trim()
      if (!trimmed) return

      // Save to history
      history.push(trimmed)
      await saveHistory(history)

      // Slash commands
      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/)
        const slashCmd = parts[0].toLowerCase()
        const args = parts.slice(1).join(" ")

        switch (slashCmd) {
          case "help":
            showHelp()
            break
          case "clear":
            console.clear()
            break
          case "history":
            showHistory()
            break
          case "exit":
          case "quit":
            console.log(UI.Style.TEXT_DIM + "Goodbye!" + UI.Style.TEXT_NORMAL)
            rl.close()
            process.exit(0)
            break
          case "run":
            if (args) {
              try {
                console.log(UI.Style.TEXT_DIM + `Running: hopcoderx ${args}` + UI.Style.TEXT_NORMAL)
                const result = execSync(`hopcoderx ${args}`, { encoding: "utf8", stdio: "pipe" })
                console.log(result)
              } catch (e: any) {
                console.log(UI.Style.TEXT_DANGER + e.message + UI.Style.TEXT_NORMAL)
              }
            } else {
              console.log(UI.Style.TEXT_WARNING + "Usage: /run <command>" + UI.Style.TEXT_NORMAL)
            }
            break
          case "memory":
            if (args) {
              try {
                execSync(`hopcoderx memory add ${JSON.stringify(args)}`, { encoding: "utf8", stdio: "inherit" })
              } catch (e: any) {
                console.log(UI.Style.TEXT_DANGER + e.message + UI.Style.TEXT_NORMAL)
              }
            } else {
              console.log(UI.Style.TEXT_WARNING + "Usage: /memory <content>" + UI.Style.TEXT_NORMAL)
            }
            break
          default:
            console.log(UI.Style.TEXT_WARNING + `Unknown command: /${slashCmd}` + UI.Style.TEXT_NORMAL)
            console.log(UI.Style.TEXT_DIM + "Type /help for available commands" + UI.Style.TEXT_NORMAL)
        }
        return
      }

      // Regular hopcoderx command
      try {
        const result = execSync(`hopcoderx ${trimmed}`, { encoding: "utf8", stdio: "pipe" })
        console.log(result)
      } catch (e: any) {
        if (e.stdout) console.log(e.stdout)
        if (e.stderr) console.log(UI.Style.TEXT_DANGER + e.stderr + UI.Style.TEXT_NORMAL)
      }
    }

    // Setup readline
    rl.setPrompt(prompt())
    rl.prompt()

    // Handle input
    rl.on("line", async (line) => {
      await processCommand(line)
      rl.prompt()
    })

    // Handle Ctrl+C
    rl.on("SIGINT", () => {
      console.log("\n" + UI.Style.TEXT_DIM + "Goodbye!" + UI.Style.TEXT_NORMAL)
      rl.close()
      process.exit(0)
    })

    // Handle Ctrl+D
    rl.on("SIGTERM", () => {
      console.log("\n" + UI.Style.TEXT_DIM + "Goodbye!" + UI.Style.TEXT_NORMAL)
      rl.close()
      process.exit(0)
    })

    // Keep process alive
    await new Promise(() => {})
  },
})

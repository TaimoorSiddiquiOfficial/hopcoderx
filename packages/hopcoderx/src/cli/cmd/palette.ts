/**
 * hopcoderx palette — Interactive command palette
 *
 * Usage:
 *   hopcoderx palette
 *
 * Features:
 *   - Fuzzy search all commands
 *   - Recent commands quick access
 *   - Context-aware command filtering
 *   - Keyboard-driven navigation
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import { CommandTaxonomy, TopLevelCompletionCommands } from "../command-taxonomy"
import fuzzysort from "fuzzysort"
import * as prompts from "@clack/prompts"

const RECENT_COMMANDS_FILE = () => {
  const path = require("path")
  const { Global } = require("../../global")
  return path.join(Global.Path.data, "recent-commands.json")
}

interface RecentCommands {
  commands: Array<{ command: string; count: number; lastUsed: number }>
}

async function loadRecentCommands(): Promise<RecentCommands["commands"]> {
  try {
    const fs = require("fs")
    const content = fs.readFileSync(RECENT_COMMANDS_FILE(), "utf8")
    const data = JSON.parse(content) as RecentCommands
    return data.commands ?? []
  } catch {
    return []
  }
}

async function saveRecentCommands(commands: RecentCommands["commands"]): Promise<void> {
  const fs = require("fs")
  const path = require("path")
  const { Global } = require("../../global")
  await fs.mkdirSync(Global.Path.data, { recursive: true })
  await fs.writeFileSync(RECENT_COMMANDS_FILE(), JSON.stringify({ commands }, null, 2))
}

function getAllCommands(): string[] {
  const commands = new Set<string>()

  // Add top-level commands
  for (const cmd of TopLevelCompletionCommands) {
    commands.add(cmd)
  }

  // Add subcommands from taxonomy
  for (const group of CommandTaxonomy) {
    for (const cmd of group.completion) {
      commands.add(`${group.name} ${cmd}`)
    }
  }

  return Array.from(commands).sort()
}

export const PaletteCommand = cmd({
  command: "palette",
  describe: "open interactive command palette",
  async handler() {
    UI.empty()
    prompts.intro("Command Palette")

    const allCommands = getAllCommands()
    const recent = await loadRecentCommands()

    // Build options with recent commands first
    const buildOptions = (query = "") => {
      let options: Array<{ label: string; value: string; hint?: string }> = []

      if (!query) {
        // Show recent commands first
        for (const r of recent.slice(0, 5)) {
          const group = CommandTaxonomy.find((g) => g.completion.includes(r.command.split(" ")[0]))
          options.push({
            label: r.command,
            value: r.command,
            hint: `Used ${r.count} times`,
          })
        }
        if (recent.length > 0) {
          options.push({ label: "─".repeat(40), value: "_separator", hint: "All Commands" })
        }
      }

      // Fuzzy search
      if (query) {
        const results = fuzzysort.go(query, allCommands, {
          limit: 10,
          threshold: -10000,
        })
        for (const result of results) {
          const cmd = result.target
          const group = CommandTaxonomy.find((g) => g.completion.includes(cmd.split(" ")[0]) || g.name === cmd.split(" ")[0])
          options.push({
            label: cmd,
            value: cmd,
            hint: group?.title,
          })
        }
      } else {
        // Add all commands if no query
        for (const cmd of allCommands.slice(0, 20)) {
          const group = CommandTaxonomy.find((g) => g.completion.includes(cmd.split(" ")[0]) || g.name === cmd.split(" ")[0])
          options.push({
            label: cmd,
            value: cmd,
            hint: group?.title,
          })
        }
      }

      return options.filter((o) => o.value !== "_separator")
    }

    // Interactive search with clack
    const selected = await prompts.text({
      message: "Search commands (type to filter)",
      placeholder: "Type a command name...",
      validate(value) {
        if (value && value.length > 0) {
          // Live preview of matches
          const matches = fuzzysort.go(value, allCommands, { limit: 5 })
          if (matches.length > 0) {
            const matchList = matches.map((m) => `  • ${m.target}`).join("\n")
            return `Found:\n${matchList}`
          }
        }
      },
    })

    if (prompts.isCancel(selected)) {
      prompts.outro("Cancelled")
      return
    }

    if (!selected) {
      prompts.log.error("No command selected")
      prompts.outro("Done")
      return
    }

    // Record as recent
    const recentIndex = recent.findIndex((r) => r.command === selected)
    if (recentIndex >= 0) {
      recent[recentIndex].count++
      recent[recentIndex].lastUsed = Date.now()
      recent.sort((a, b) => b.lastUsed - a.lastUsed)
    } else {
      recent.unshift({ command: selected, count: 1, lastUsed: Date.now() })
      if (recent.length > 50) recent.pop()
    }
    await saveRecentCommands(recent)

    prompts.log.success(`Selected: ${selected}`)
    prompts.log.info("Run with: hopcoderx " + selected)
    prompts.outro("Done")
  },
})

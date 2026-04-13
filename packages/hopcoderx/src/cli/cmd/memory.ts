/**
 * `hopcoderx memory` — persistent code memory CLI.
 *
 * Sub-commands:
 *   memory add <content>          Store a new memory
 *   memory search <query>         Semantic keyword search
 *   memory list [--project]       List memories (optionally filter by current project)
 *   memory delete <id>            Delete a memory by ID
 *   memory export                 Export all memories as JSON
 *   memory clear                  Wipe all memories
 *   memory stats                  Show memory store statistics
 *   memory panel                  Interactive TUI memory viewer (live search + delete)
 *   memory sync                   Sync with team shared memory server
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { cwd } from "process"
import { createInterface } from "readline"
import { MemoryPlugin } from "../../memory/memory"
import { SQLiteMemory } from "../../memory/sqlite"
import { runDreaming, readDreamLog } from "../../memory/dreaming"
import { teamMemory } from "../../memory/team"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"

async function initMemory() {
  if (!MemoryPlugin.isActive()) {
    const backend = new SQLiteMemory()
    await backend.init()
    MemoryPlugin.register(backend)
  }
}

export const MemoryCommand = cmd({
  command: "memory <action>",
  describe: "Persistent code memory — store, search, and recall patterns across sessions",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "Action to perform",
        type: "string",
        choices: ["add", "search", "list", "delete", "export", "clear", "stats", "dream", "panel", "sync"] as const,
      })
      .option("content", { alias: "c", type: "string", description: "Memory content to store" })
      .option("query",   { alias: "q", type: "string", description: "Search query" })
      .option("tags",    { alias: "t", type: "array",  description: "Tags to filter or apply" })
      .option("project", { alias: "p", type: "boolean", description: "Scope to current project", default: false })
      .option("id",      { type: "string", description: "Memory ID (for delete)" })
      .option("global",  { alias: "g", type: "boolean", description: "Store as global (not project-scoped)", default: false })
      .option("score",   { type: "number", description: "Importance score 0-10", default: 1.0 })
      .option("sync-url", { type: "string", description: "Team sync server URL (or set HOPCODERX_TEAM_SYNC_URL)" })
      .option("sync-key", { type: "string", description: "Team sync API key (or set HOPCODERX_TEAM_SYNC_KEY)" })
      .option("dry-run", { type: "boolean", description: "Preview changes without applying", default: false }),
  handler: async (args: {
    action?: string
    content?: string
    query?: string
    tags?: (string | number)[]
    project?: boolean
    id?: string
    global?: boolean
    score?: number
    "sync-url"?: string
    "sync-key"?: string
    "dry-run"?: boolean
  }) => {
    await initMemory()
    const mem = MemoryPlugin.active
    const tags = (args.tags ?? []).map(String)
    const projectScope = args.global ? null : cwd()

    switch (args.action ?? "") {
      case "add": {
        UI.empty()
        prompts.intro("Add Memory")
        const content = args.content ?? args.query
        if (!content) {
          prompts.log.error("Provide content with --content or as argument")
          prompts.outro("Failed")
          process.exit(1)
        }
        const entry = await mem.upsert({
          content,
          tags,
          projectScope: args.project ? projectScope : null,
          score: args.score ?? 1.0,
        })
        prompts.log.success(`Memory stored  id=${entry.id}`)
        prompts.outro("Done")
        break
      }

      case "search": {
        UI.empty()
        prompts.intro("Search Memories")
        const query = args.query ?? args.content
        if (!query) {
          prompts.log.error("Provide a search query with --query")
          prompts.outro("Failed")
          process.exit(1)
        }
        const results = await mem.search(query, {
          limit: 10,
          projectScope: args.project ? projectScope : undefined,
          tags: tags.length ? tags : undefined,
        })
        if (results.length === 0) {
          prompts.log.info("No memories found")
          prompts.outro("Done")
          break
        }
        prompts.log.info(`\nSearch results for "${query}":\n`)
        for (const r of results) {
          const score = (r.similarity * 100).toFixed(0)
          const proj = r.entry.projectScope ? ` [${r.entry.projectScope.split(/[\\/]/).pop()}]` : " [global]"
          prompts.log.info(`  ${r.entry.id.slice(0, 8)}  ${score}%${proj}  ${r.entry.content.slice(0, 120)}`)
          if (r.entry.tags.length) prompts.log.info(`         tags: ${r.entry.tags.join(", ")}`)
        }
        prompts.outro(`${results.length} result(s)`)
        break
      }

      case "list": {
        UI.empty()
        prompts.intro("Memories")
        const entries = await mem.list({
          projectScope: args.project ? projectScope : undefined,
          tags: tags.length ? tags : undefined,
          limit: 50,
        })
        if (entries.length === 0) {
          prompts.log.info("No memories found")
          prompts.outro("Done")
          break
        }
        prompts.log.info(`\nMemories (${entries.length}):\n`)
        for (const e of entries) {
          const proj = e.projectScope ? e.projectScope.split(/[\\/]/).pop() : "global"
          const date = new Date(e.updatedAt).toLocaleDateString()
          prompts.log.info(`  ${e.id.slice(0, 8)}  [${proj}]  ${date}  score=${e.score}`)
          prompts.log.info(`         ${e.content.slice(0, 100)}`)
          if (e.tags.length) prompts.log.info(`         tags: ${e.tags.join(", ")}`)
        }
        prompts.outro(`${entries.length} memory(ies)`)
        break
      }

      case "delete": {
        UI.empty()
        prompts.intro("Delete Memory")
        if (!args.id) {
          prompts.log.error("Provide --id of the memory to delete")
          prompts.outro("Failed")
          process.exit(1)
        }
        if (args["dry-run"]) {
          prompts.log.info(`[dry-run] Would delete memory ${args.id}`)
          prompts.outro("Dry run complete")
          break
        }
        await mem.delete(args.id)
        prompts.log.success(`Memory ${args.id} deleted`)
        prompts.outro("Done")
        break
      }

      case "export": {
        UI.empty()
        prompts.intro("Export Memories")
        const all = await mem.export()
        process.stdout.write(JSON.stringify(all, null, 2) + "\n")
        prompts.outro(`${all.length} memory(ies) exported`)
        break
      }

      case "clear": {
        UI.empty()
        prompts.intro("Clear Memories")
        if (args["dry-run"]) {
          const entries = await mem.list()
          prompts.log.info(`[dry-run] Would clear ${entries.length} memories`)
          prompts.outro("Dry run complete")
          break
        }
        await mem.clear()
        prompts.log.success("All memories cleared")
        prompts.outro("Done")
        break
      }

      case "stats": {
        UI.empty()
        prompts.intro("Memory Stats")
        const all = await mem.list()
        const projects = new Set(all.map((e) => e.projectScope).filter(Boolean))
        const globalCount = all.filter((e) => !e.projectScope).length
        prompts.log.info(`\nTotal entries : ${all.length}`)
        prompts.log.info(`Projects      : ${projects.size}`)
        prompts.log.info(`Global        : ${globalCount}`)
        const tagCounts: Record<string, number> = {}
        for (const e of all) { for (const t of e.tags) { tagCounts[t] = (tagCounts[t] ?? 0) + 1 } }
        const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
        if (topTags.length) {
          prompts.log.info(`Top tags      : ${topTags.map(([t, n]) => `${t}(${n})`).join(", ")}`)
        }
        prompts.outro("Done")
        break
      }

      case "dream": {
        UI.empty()
        prompts.intro("Memory Consolidation")
        prompts.log.info("Running memory consolidation (dreaming)…")
        const spinner = prompts.spinner()
        spinner.start("Processing")
        const report = await runDreaming()
        spinner.stop()
        prompts.log.success(`Done in ${report.durationMs}ms`)
        prompts.log.info(`  Merged   : ${report.merged}`)
        prompts.log.info(`  Decayed  : ${report.decayed}`)
        prompts.log.info(`  Insights : ${report.insights.length}`)
        for (const insight of report.insights) prompts.log.info(`    💡 ${insight}`)
        const history = await readDreamLog(5)
        if (history.length > 1) {
          prompts.log.info(`\nLast ${history.length} dream runs:`)
          for (const r of history.slice(0, -1).reverse()) {
            const d = new Date(r.timestamp).toLocaleString()
            prompts.log.info(`  ${d}  merged=${r.merged} decayed=${r.decayed}`)
          }
        }
        prompts.outro("Done")
        break
      }

      case "panel": {
        await runMemoryPanel()
        break
      }

      case "sync": {
        UI.empty()
        prompts.intro("Team Memory Sync")
        teamMemory.configure({
          syncUrl: args["sync-url"],
          syncKey: args["sync-key"],
        })
        if (!teamMemory.isConfigured()) {
          prompts.log.error("Team sync not configured. Set HOPCODERX_TEAM_SYNC_URL and HOPCODERX_TEAM_SYNC_KEY, or pass --sync-url / --sync-key.")
          prompts.outro("Failed")
          process.exit(1)
        }
        prompts.log.info("Syncing with team memory server…")
        const spinner = prompts.spinner()
        spinner.start("Syncing")
        const result = await teamMemory.sync()
        spinner.stop()
        prompts.log.success("Sync complete")
        prompts.log.info(`  Pushed    : ${result.pushed}`)
        prompts.log.info(`  Pulled    : ${result.pulled}`)
        prompts.log.info(`  Conflicts : ${result.conflicts}`)
        prompts.outro("Done")
        break
      }

      case "panel": {
        await runMemoryPanel()
        break
      }

      default:
        prompts.log.error(`Unknown action: ${args.action}`)
        prompts.outro("Failed")
        process.exit(1)
    }
  },
})

function renderMemoryPanel(
  entries: Array<{ id: string; content: string; tags: string[]; projectScope: string | null; score: number; updatedAt: number }>,
  filter: string,
  selected: number,
  total: number,
): string {
  const filtered = filter
    ? entries.filter((e) => e.content.toLowerCase().includes(filter.toLowerCase()) || e.tags.some((t) => t.includes(filter)))
    : entries

  const lines: string[] = []
  const width = Math.min(process.stdout.columns ?? 100, 120)
  const divider = "─".repeat(width)

  lines.push(`╔${"═".repeat(width - 2)}╗`)
  lines.push(`║  🧠 HopCoderX Memory Panel  [${filtered.length}/${total} entries]  filter: ${filter || "(none)"}  ${" ".repeat(Math.max(0, width - 60 - filter.length))}║`)
  lines.push(`╠${"═".repeat(width - 2)}╣`)
  lines.push(`║  ${"ID".padEnd(10)}  ${"Score".padEnd(5)}  ${"Tags".padEnd(20)}  ${"Updated".padEnd(12)}  Content${" ".repeat(Math.max(0, width - 67))}║`)
  lines.push(`╠${divider.slice(0, width - 2)}╣`)

  const visibleStart = Math.max(0, selected - 5)
  const visible = filtered.slice(visibleStart, visibleStart + 15)

  if (visible.length === 0) {
    lines.push(`║  (no entries match filter)${" ".repeat(width - 29)}║`)
  }
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i]
    const idx = visibleStart + i
    const isSelected = idx === selected
    const prefix = isSelected ? "▶ " : "  "
    const id = e.id.slice(0, 8).padEnd(10)
    const score = e.score.toFixed(1).padEnd(5)
    const tags = (e.tags.slice(0, 3).join(",") || "-").slice(0, 20).padEnd(20)
    const date = new Date(e.updatedAt).toLocaleDateString().padEnd(12)
    const content = e.content.replace(/\n/g, " ").slice(0, Math.max(0, width - 65))
    lines.push(`║${prefix}${id}  ${score}  ${tags}  ${date}  ${content.padEnd(Math.max(0, width - 65))}║`)
  }

  lines.push(`╠${divider.slice(0, width - 2)}╣`)
  lines.push(`║  [↑↓] navigate  [/] filter  [d] delete  [e] export  [q] quit${" ".repeat(Math.max(0, width - 64))}║`)
  lines.push(`╚${"═".repeat(width - 2)}╝`)

  return lines.join("\n")
}

async function runMemoryPanel(): Promise<void> {
  await initMemory()
  const mem = MemoryPlugin.active
  let entries = await mem.list({ limit: 1000 })
  let filter = ""
  let selected = 0
  let filterMode = false

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  const render = () => {
    // Clear screen and re-render
    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write(renderMemoryPanel(entries, filter, selected, entries.length))
    if (filterMode) process.stdout.write(`\n  Filter: ${filter}_`)
  }

  // Set raw mode for keypress
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.resume()

  render()

  process.stdin.on("data", async (chunk: Buffer) => {
    const key = chunk.toString()

    if (filterMode) {
      if (key === "\r" || key === "\n" || key === "\x1b") {
        filterMode = false
        selected = 0
      } else if (key === "\x7f") {
        filter = filter.slice(0, -1)
      } else if (key.length === 1 && key >= " ") {
        filter += key
      }
      render()
      return
    }

    const filtered = filter
      ? entries.filter((e) => e.content.toLowerCase().includes(filter.toLowerCase()) || e.tags.some((t) => t.includes(filter)))
      : entries

    if (key === "q" || key === "\x03") {
      if (process.stdin.isTTY) process.stdin.setRawMode(false)
      rl.close()
      process.stdout.write("\x1b[2J\x1b[H")
      process.exit(0)
    } else if (key === "\x1b[A" || key === "k") {
      selected = Math.max(0, selected - 1)
    } else if (key === "\x1b[B" || key === "j") {
      selected = Math.min(filtered.length - 1, selected + 1)
    } else if (key === "/") {
      filterMode = true
      filter = ""
      selected = 0
    } else if (key === "d" && filtered[selected]) {
      const id = filtered[selected].id
      await mem.delete(id)
      entries = await mem.list({ limit: 1000 })
      selected = Math.min(selected, entries.length - 1)
      console.log(`\n  Deleted: ${id}`)
    } else if (key === "e") {
      const all = await mem.export()
      const out = JSON.stringify(all, null, 2)
      process.stdout.write("\x1b[2J\x1b[H")
      console.log(out)
      if (process.stdin.isTTY) process.stdin.setRawMode(false)
      rl.close()
      return
    } else if (key === "r") {
      entries = await mem.list({ limit: 1000 })
      selected = 0
    }

    render()
  })
}

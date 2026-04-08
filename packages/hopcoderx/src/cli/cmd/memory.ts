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
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { cwd } from "process"
import { MemoryPlugin } from "../../memory/memory"
import { SQLiteMemory } from "../../memory/sqlite"

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
        choices: ["add", "search", "list", "delete", "export", "clear", "stats"] as const,
      })
      .option("content", { alias: "c", type: "string", description: "Memory content to store" })
      .option("query",   { alias: "q", type: "string", description: "Search query" })
      .option("tags",    { alias: "t", type: "array",  description: "Tags to filter or apply" })
      .option("project", { alias: "p", type: "boolean", description: "Scope to current project", default: false })
      .option("id",      { type: "string", description: "Memory ID (for delete)" })
      .option("global",  { alias: "g", type: "boolean", description: "Store as global (not project-scoped)", default: false })
      .option("score",   { type: "number", description: "Importance score 0-10", default: 1.0 }),
  handler: async (args: {
    action?: string
    content?: string
    query?: string
    tags?: (string | number)[]
    project?: boolean
    id?: string
    global?: boolean
    score?: number
  }) => {
    await initMemory()
    const mem = MemoryPlugin.active
    const tags = (args.tags ?? []).map(String)
    const projectScope = args.global ? null : cwd()

    switch (args.action ?? "") {
      case "add": {
        const content = args.content ?? args.query
        if (!content) { console.error("Provide content with --content or as argument"); process.exit(1) }
        const entry = await mem.upsert({
          content,
          tags,
          projectScope: args.project ? projectScope : null,
          score: args.score ?? 1.0,
        })
        console.log(`✅ Memory stored  id=${entry.id}`)
        break
      }

      case "search": {
        const query = args.query ?? args.content
        if (!query) { console.error("Provide a search query with --query"); process.exit(1) }
        const results = await mem.search(query, {
          limit: 10,
          projectScope: args.project ? projectScope : undefined,
          tags: tags.length ? tags : undefined,
        })
        if (results.length === 0) { console.log("No memories found."); break }
        console.log(`\n🔍 Search results for "${query}":\n`)
        for (const r of results) {
          const score = (r.similarity * 100).toFixed(0)
          const proj = r.entry.projectScope ? ` [${r.entry.projectScope.split(/[\\/]/).pop()}]` : " [global]"
          console.log(`  ${r.entry.id.slice(0, 8)}  ${score}%${proj}  ${r.entry.content.slice(0, 120)}`)
          if (r.entry.tags.length) console.log(`         tags: ${r.entry.tags.join(", ")}`)
        }
        break
      }

      case "list": {
        const entries = await mem.list({
          projectScope: args.project ? projectScope : undefined,
          tags: tags.length ? tags : undefined,
          limit: 50,
        })
        if (entries.length === 0) { console.log("No memories found."); break }
        console.log(`\n📋 Memories (${entries.length}):\n`)
        for (const e of entries) {
          const proj = e.projectScope ? e.projectScope.split(/[\\/]/).pop() : "global"
          const date = new Date(e.updatedAt).toLocaleDateString()
          console.log(`  ${e.id.slice(0, 8)}  [${proj}]  ${date}  score=${e.score}`)
          console.log(`         ${e.content.slice(0, 100)}`)
          if (e.tags.length) console.log(`         tags: ${e.tags.join(", ")}`)
        }
        break
      }

      case "delete": {
        if (!args.id) { console.error("Provide --id of the memory to delete"); process.exit(1) }
        await mem.delete(args.id)
        console.log(`🗑  Memory ${args.id} deleted.`)
        break
      }

      case "export": {
        const all = await mem.export()
        console.log(JSON.stringify(all, null, 2))
        break
      }

      case "clear": {
        await mem.clear()
        console.log("🧹 All memories cleared.")
        break
      }

      case "stats": {
        const all = await mem.list()
        const projects = new Set(all.map((e) => e.projectScope).filter(Boolean))
        const globalCount = all.filter((e) => !e.projectScope).length
        console.log(`\n📊 Memory Stats`)
        console.log(`  Total entries : ${all.length}`)
        console.log(`  Projects      : ${projects.size}`)
        console.log(`  Global        : ${globalCount}`)
        const tagCounts: Record<string, number> = {}
        for (const e of all) { for (const t of e.tags) { tagCounts[t] = (tagCounts[t] ?? 0) + 1 } }
        const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
        if (topTags.length) {
          console.log(`  Top tags      : ${topTags.map(([t, n]) => `${t}(${n})`).join(", ")}`)
        }
        break
      }

      default:
        console.error(`Unknown action: ${args.action}`)
        process.exit(1)
    }
  },
})

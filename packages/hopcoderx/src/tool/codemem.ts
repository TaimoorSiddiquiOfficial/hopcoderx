/**
 * Code memory injection — auto-recalls relevant memories as context.
 *
 * Provides two agent tools:
 *   recall   — search memory store for patterns/facts relevant to the current task
 *   remember — explicitly store a coding pattern/solution for future sessions
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { MemoryPlugin } from "../memory/memory"
import { SQLiteMemory } from "../memory/sqlite"
import { cwd } from "process"

type Meta = Record<string, string | number | boolean | undefined>

const recallParameters = z.object({
  query: z.string().describe("The coding task or question to search memories for"),
  limit: z.number().optional().default(5).describe("Max memories to return"),
  tags: z.array(z.string()).optional().describe("Filter by tags"),
})

async function ensureMemory() {
  if (!MemoryPlugin.isActive()) {
    const backend = new SQLiteMemory()
    await backend.init()
    MemoryPlugin.register(backend)
  }
}

export const RecallMemoryTool = Tool.define<typeof recallParameters, Meta>("recall", {
  description: "Search persistent code memory for relevant patterns, solutions, and facts from past sessions",
  parameters: recallParameters,
  async execute({ query, limit, tags }) {
    try {
      await ensureMemory()
      const results = await MemoryPlugin.active.search(query, {
        limit: limit ?? 5,
        projectScope: cwd(),
        tags,
      })
      if (!results.length) {
        return { title: "recall", output: "No relevant memories found.", metadata: {} as Meta }
      }
      const formatted = results
        .map((r, i) => `[${i + 1}] (${(r.similarity * 100).toFixed(0)}% match) ${r.entry.content}`)
        .join("\n\n")
      return {
        title: "recall",
        output: `Recalled ${results.length} relevant memories:\n\n${formatted}`,
        metadata: {} as Meta,
      }
    } catch (e) {
      return { title: "recall", output: `Memory recall unavailable: ${e instanceof Error ? e.message : e}`, metadata: {} as Meta }
    }
  },
})

const rememberParameters = z.object({
  content: z.string().describe("The memory to store (pattern, solution, fact, preference)"),
  tags: z.array(z.string()).optional().describe("Tags: 'pattern', 'error', 'preference', 'fact', 'solution'"),
  score: z.number().optional().default(1.0).describe("Importance score 0-10"),
})

export const RememberTool = Tool.define<typeof rememberParameters, Meta>("remember", {
  description: "Store a code pattern, solution, or project fact in persistent memory for future sessions",
  parameters: rememberParameters,
  async execute({ content, tags, score }) {
    try {
      await ensureMemory()
      const entry = await MemoryPlugin.active.upsert({
        content,
        tags: tags ?? [],
        projectScope: cwd(),
        score: score ?? 1.0,
      })
      return { title: "remember", output: `✅ Memory stored (id=${entry.id})`, metadata: {} as Meta }
    } catch (e) {
      return { title: "remember", output: `Failed to store memory: ${e instanceof Error ? e.message : e}`, metadata: {} as Meta }
    }
  },
})


import z from "zod"
import { Tool } from "./tool"
import { Store } from "../rag/store"
import { Indexer } from "../rag/indexer"
import { Instance } from "../project/instance"
import path from "path"

import DESCRIPTION from "./semanticsearch.txt"

export const SemanticSearchTool = Tool.define("semanticsearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe("Natural language query describing the code you're looking for, or a symbol name to search for"),
    mode: z
      .enum(["code", "symbol", "references"])
      .default("code")
      .describe(
        "Search mode: 'code' for full-text code search, 'symbol' for function/class/type definitions, 'references' for symbol usage graph",
      ),
    kind: z
      .string()
      .optional()
      .describe(
        "Filter symbols by kind (only for symbol/references mode): function, class, interface, type, method, struct, enum, namespace",
      ),
    limit: z.number().min(1).max(50).default(15).describe("Maximum number of results to return"),
  }),
  async execute(params, ctx) {
    // ensure index is up to date
    const stats = Indexer.indexed()
    if (stats.files === 0) {
      ctx.metadata({ title: "Indexing codebase..." })
      await Indexer.index(ctx.abort)
    }

    if (params.mode === "symbol") return symbolSearch(params.query, params.kind, params.limit)
    if (params.mode === "references") return referenceSearch(params.query)
    return codeSearch(params.query, params.limit)
  },
})

function codeSearch(query: string, limit: number) {
  const results = Store.search(query, limit)
  if (!results.length) {
    return {
      title: query,
      metadata: { matches: 0 },
      output: "No matching code found. Try a different query or use grep for exact pattern matching.",
    }
  }

  const lines = results.map((r) => {
    const location = `${r.filepath}:${r.start_line}-${r.end_line}`
    const label = r.symbol_name ? `[${r.symbol_type}] ${r.symbol_name}` : r.symbol_type
    const preview = truncate(r.content, 500)
    return `### ${location}\n${label}\n\`\`\`\n${preview}\n\`\`\``
  })

  return {
    title: query,
    metadata: { matches: results.length },
    output: `Found ${results.length} results:\n\n${lines.join("\n\n")}`,
  }
}

function symbolSearch(query: string, kind: string | undefined, limit: number) {
  const results = Store.findSymbols(query, kind, limit)
  if (!results.length) {
    return {
      title: `symbol: ${query}`,
      metadata: { matches: 0 },
      output: "No matching symbols found.",
    }
  }

  const lines = results.map((s) => {
    const loc = `${s.filepath}:${s.start_line}-${s.end_line}`
    const parent = s.parent ? ` (in ${s.parent})` : ""
    const sig = s.signature ? `\n  ${s.signature}` : ""
    return `- [${s.kind}] **${s.name}**${parent} — ${loc}${sig}`
  })

  return {
    title: `symbol: ${query}`,
    metadata: { matches: results.length },
    output: `Found ${results.length} symbols:\n\n${lines.join("\n")}`,
  }
}

function referenceSearch(query: string) {
  const refs = Store.references(query)
  if (!refs.length) {
    return {
      title: `refs: ${query}`,
      metadata: { matches: 0 },
      output: `No references found for "${query}".`,
    }
  }

  const incoming = refs.filter((r) => r.target_symbol === query)
  const outgoing = refs.filter((r) => r.source_symbol === query)

  const lines: string[] = []
  if (incoming.length) {
    lines.push(`**Used by** (${incoming.length}):`)
    for (const r of incoming) lines.push(`  - ${r.source_symbol} in ${r.source_filepath} (${r.kind})`)
  }
  if (outgoing.length) {
    lines.push(`**Depends on** (${outgoing.length}):`)
    for (const r of outgoing) lines.push(`  - ${r.target_symbol} (${r.kind})`)
  }

  return {
    title: `refs: ${query}`,
    metadata: { matches: refs.length },
    output: lines.join("\n"),
  }
}

function truncate(content: string, max: number) {
  if (content.length <= max) return content
  return content.slice(0, max) + "\n... (truncated)"
}

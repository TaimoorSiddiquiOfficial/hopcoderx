import z from "zod"
import { Tool } from "./tool"
import { Env } from "../env"
import { abortAfterAny } from "../util/abort"

type Meta = Record<string, string | number | boolean | undefined>

interface ExaResult {
  id: string
  url: string
  title: string
  text?: string
  highlights?: string[]
  score?: number
  publishedDate?: string
  author?: string
}

interface ExaResponse {
  requestId: string
  results: ExaResult[]
  resolvedSearchType?: string
}

const parameters = z.object({
  query: z.string().describe("Search query — can be a natural language question or statement"),
  type: z
    .enum(["auto", "keyword", "neural"])
    .optional()
    .describe("Search type: auto (default), keyword (exact match), or neural (semantic similarity)"),
  num_results: z.number().optional().describe("Number of results (default: 5, max: 25)"),
  include_text: z.boolean().optional().describe("Include full page text content (default: true)"),
  max_characters: z.number().optional().describe("Max characters per result content (default: 3000)"),
  start_published_date: z.string().optional().describe("Filter results published after this date (YYYY-MM-DD)"),
  include_domains: z.array(z.string()).optional().describe("Restrict results to these domains"),
  exclude_domains: z.array(z.string()).optional().describe("Exclude results from these domains"),
})

export const ExaSearchTool = Tool.define<typeof parameters, Meta>("exa-search", {
  description:
    "Search the web using Exa AI — semantic neural search engine that finds conceptually relevant results rather than just keyword matches. Great for technical research, finding similar content, and discovering authoritative sources. Requires EXA_API_KEY.",
  parameters,
  async execute(params, ctx) {
    const apiKey = Env.get("EXA_API_KEY")
    if (!apiKey) {
      return {
        output: "EXA_API_KEY is not set. Get an API key at https://exa.ai",
        title: "Exa Search: API key missing",
        metadata: {} as Meta,
      }
    }

    await ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: { query: params.query },
    })

    const { signal, clearTimeout } = abortAfterAny(30000, ctx.abort)

    try {
      const body: Record<string, unknown> = {
        query: params.query,
        type: params.type ?? "auto",
        numResults: Math.min(params.num_results ?? 5, 25),
        contents: {
          text: params.include_text !== false ? { maxCharacters: params.max_characters ?? 3000 } : false,
          highlights: { numSentences: 3, highlightsPerUrl: 2 },
        },
      }
      if (params.start_published_date) body.startPublishedDate = params.start_published_date
      if (params.include_domains) body.includeDomains = params.include_domains
      if (params.exclude_domains) body.excludeDomains = params.exclude_domains

      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      })
      clearTimeout()

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Exa error (${res.status}): ${err}`)
      }

      const data: ExaResponse = await res.json()

      const lines: string[] = [`**Exa Search:** ${params.query} (${data.resolvedSearchType ?? params.type ?? "auto"})\n`]
      for (const r of data.results) {
        lines.push(`### ${r.title ?? r.url}`)
        lines.push(`URL: ${r.url}`)
        if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`)
        if (r.author) lines.push(`Author: ${r.author}`)
        if (r.highlights?.length) {
          lines.push("\n**Key excerpts:**")
          for (const h of r.highlights) lines.push(`> ${h}`)
        }
        if (r.text) lines.push(`\n${r.text}`)
        lines.push("")
      }

      return {
        output: lines.join("\n"),
        title: `Exa: ${params.query}`,
        metadata: { resultCount: data.results.length, searchType: data.resolvedSearchType ?? "" } as Meta,
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") throw new Error("Exa search timed out")
      throw err
    }
  },
})

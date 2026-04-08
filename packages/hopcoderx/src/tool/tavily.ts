import z from "zod"
import { Tool } from "./tool"
import { Env } from "../env"
import { abortAfterAny } from "../util/abort"

type Meta = Record<string, string | number | boolean | undefined>

interface TavilySearchResult {
  url: string
  title: string
  content: string
  score: number
  published_date?: string
}

interface TavilyResponse {
  query: string
  results: TavilySearchResult[]
  answer?: string
}

const parameters = z.object({
  query: z.string().describe("Search query"),
  search_depth: z
    .enum(["basic", "advanced"])
    .optional()
    .describe("Search depth: basic (faster) or advanced (more comprehensive, default: basic)"),
  max_results: z.number().optional().describe("Maximum number of results (default: 5, max: 20)"),
  include_answer: z.boolean().optional().describe("Include an AI-generated answer summary (default: true)"),
  include_domains: z.array(z.string()).optional().describe("Restrict results to these domains"),
  exclude_domains: z.array(z.string()).optional().describe("Exclude results from these domains"),
})

export const TavilySearchTool = Tool.define<typeof parameters, Meta>("tavily-search", {
  description:
    "Search the web using Tavily AI search engine — optimized for AI agents. Returns relevant, up-to-date results with content snippets. Requires TAVILY_API_KEY.",
  parameters,
  async execute(params, ctx) {
    const apiKey = Env.get("TAVILY_API_KEY")
    if (!apiKey) {
      return {
        output: "TAVILY_API_KEY is not set. Get a free API key at https://tavily.com",
        title: "Tavily Search: API key missing",
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
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query: params.query,
          search_depth: params.search_depth ?? "basic",
          max_results: Math.min(params.max_results ?? 5, 20),
          include_answer: params.include_answer !== false,
          include_domains: params.include_domains,
          exclude_domains: params.exclude_domains,
        }),
        signal,
      })
      clearTimeout()

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Tavily error (${res.status}): ${err}`)
      }

      const data: TavilyResponse = await res.json()

      const lines: string[] = []
      if (data.answer) lines.push(`**AI Summary:** ${data.answer}\n`)
      lines.push(`**Results for:** ${data.query}\n`)
      for (const r of data.results) {
        lines.push(`### ${r.title}`)
        lines.push(`URL: ${r.url}`)
        if (r.published_date) lines.push(`Date: ${r.published_date}`)
        lines.push(r.content)
        lines.push("")
      }

      return {
        output: lines.join("\n"),
        title: `Tavily: ${params.query}`,
        metadata: { resultCount: data.results.length } as Meta,
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") throw new Error("Tavily search timed out")
      throw err
    }
  },
})

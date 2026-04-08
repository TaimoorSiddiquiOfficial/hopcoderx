import z from "zod"
import { Tool } from "./tool"
import { Env } from "../env"
import { abortAfterAny } from "../util/abort"

type Meta = Record<string, string | number | boolean | undefined>

interface FirecrawlScrapeResponse {
  success: boolean
  data?: {
    markdown?: string
    html?: string
    rawHtml?: string
    screenshot?: string
    links?: string[]
    metadata?: {
      title?: string
      description?: string
      language?: string
      ogTitle?: string
      statusCode?: number
    }
  }
  error?: string
}

interface FirecrawlCrawlResponse {
  success: boolean
  id?: string
  url?: string
  error?: string
}

interface FirecrawlCrawlStatus {
  status: "scraping" | "completed" | "failed" | "cancelled"
  total?: number
  completed?: number
  data?: Array<{ markdown?: string; metadata?: { title?: string; sourceURL?: string } }>
  error?: string
}

const parameters = z.object({
  action: z.enum(["scrape", "crawl", "extract"]).describe("Action: scrape (single page), crawl (entire site), or extract (structured data)"),
  url: z.string().describe("URL to scrape/crawl"),
  formats: z
    .array(z.enum(["markdown", "html", "rawHtml", "links", "screenshot"]))
    .optional()
    .describe("Output formats to include (default: ['markdown'])"),
  only_main_content: z.boolean().optional().describe("Extract only main content, excluding nav/footer (default: true)"),
  max_depth: z.number().optional().describe("Max crawl depth for 'crawl' action (default: 2)"),
  limit: z.number().optional().describe("Max pages to crawl for 'crawl' action (default: 10)"),
  extract_schema: z
    .string()
    .optional()
    .describe("JSON schema string for structured extraction with 'extract' action"),
  extract_prompt: z.string().optional().describe("Natural language extraction prompt for 'extract' action"),
})

export const FirecrawlTool = Tool.define<typeof parameters, Meta>("firecrawl", {
  description:
    "Scrape or crawl websites and extract clean markdown content. Use 'scrape' for a single URL, 'crawl' to extract an entire site, or 'extract' for structured data extraction. Requires FIRECRAWL_API_KEY.",
  parameters,
  async execute(params, ctx) {
    const apiKey = Env.get("FIRECRAWL_API_KEY")
    if (!apiKey) {
      return {
        output: "FIRECRAWL_API_KEY is not set. Get an API key at https://firecrawl.dev",
        title: "Firecrawl: API key missing",
        metadata: {} as Meta,
      }
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, action: params.action },
    })

    const { signal, clearTimeout } = abortAfterAny(60000, ctx.abort)
    const base = "https://api.firecrawl.dev/v1"

    try {
      if (params.action === "scrape") {
        const res = await fetch(`${base}/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            url: params.url,
            formats: params.formats ?? ["markdown"],
            onlyMainContent: params.only_main_content !== false,
          }),
          signal,
        })
        clearTimeout()

        if (!res.ok) throw new Error(`Firecrawl scrape error (${res.status}): ${await res.text()}`)
        const data: FirecrawlScrapeResponse = await res.json()
        if (!data.success || !data.data) throw new Error(data.error ?? "Scrape failed")

        const meta = data.data.metadata
        const lines = [`# ${meta?.title ?? params.url}`, `URL: ${params.url}`, ""]
        if (meta?.description) lines.push(`> ${meta.description}`, "")
        if (data.data.markdown) lines.push(data.data.markdown)
        if (data.data.links?.length) {
          lines.push("", "## Links")
          for (const l of data.data.links.slice(0, 20)) lines.push(`- ${l}`)
        }

        return {
          output: lines.join("\n"),
          title: `Firecrawl: ${meta?.title ?? params.url}`,
          metadata: { statusCode: meta?.statusCode, url: params.url } as Meta,
        }
      }

      if (params.action === "extract") {
        const body: Record<string, unknown> = {
          urls: [params.url],
          prompt: params.extract_prompt,
        }
        if (params.extract_schema) {
          try {
            body.schema = JSON.parse(params.extract_schema)
          } catch {
            body.schema = {}
          }
        }

        const res = await fetch(`${base}/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal,
        })
        clearTimeout()

        if (!res.ok) throw new Error(`Firecrawl extract error (${res.status}): ${await res.text()}`)
        const data = await res.json()

        return {
          output: JSON.stringify(data?.data ?? data, null, 2),
          title: `Firecrawl Extract: ${params.url}`,
          metadata: {} as Meta,
        }
      }

      // crawl action
      const crawlRes = await fetch(`${base}/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          url: params.url,
          maxDepth: params.max_depth ?? 2,
          limit: Math.min(params.limit ?? 10, 50),
          scrapeOptions: { formats: ["markdown"], onlyMainContent: params.only_main_content !== false },
        }),
        signal,
      })

      if (!crawlRes.ok) throw new Error(`Firecrawl crawl error (${crawlRes.status}): ${await crawlRes.text()}`)
      const crawlData: FirecrawlCrawlResponse = await crawlRes.json()
      if (!crawlData.success || !crawlData.id) throw new Error(crawlData.error ?? "Crawl failed to start")

      const crawlId = crawlData.id
      let status: FirecrawlCrawlStatus = { status: "scraping" }
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const statusRes = await fetch(`${base}/crawl/${crawlId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        })
        if (!statusRes.ok) break
        status = await statusRes.json()
        if (status.status === "completed" || status.status === "failed") break
      }
      clearTimeout()

      if (status.status === "failed") throw new Error(status.error ?? "Crawl failed")

      const lines = [`# Crawl results for: ${params.url}`, `Pages: ${status.completed ?? 0}/${status.total ?? "?"}`, ""]
      for (const page of status.data ?? []) {
        if (page.metadata?.title) lines.push(`## ${page.metadata.title}`)
        if (page.metadata?.sourceURL) lines.push(`URL: ${page.metadata.sourceURL}`)
        if (page.markdown) lines.push(page.markdown.slice(0, 2000))
        lines.push("")
      }

      return {
        output: lines.join("\n"),
        title: `Firecrawl Crawl: ${params.url}`,
        metadata: { pages: status.completed ?? 0, crawlId } as Meta,
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") throw new Error("Firecrawl request timed out")
      throw err
    }
  },
})

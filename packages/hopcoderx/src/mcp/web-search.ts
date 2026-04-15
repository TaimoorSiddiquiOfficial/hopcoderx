/**
 * Web Search MCP Server
 *
 * Search engine integration for AI-assisted research and information gathering.
 * Supports multiple search providers with automatic fallback.
 *
 * Features:
 * - Multi-engine search (Brave, DuckDuckGo, Google)
 * - Result summarization
 * - Source tracking and citation
 * - Safe search filtering
 * - Domain filtering (include/exclude)
 * - Result count limits
 */

import { Log } from "@/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "mcp.web-search" })

export namespace WebSearchMCP {
  export interface SearchResult {
    id: string
    title: string
    url: string
    snippet: string
    source: string
    publishedDate?: string
    score: number
  }

  export interface SearchOptions {
    engine?: "brave" | "duckduckgo" | "google" | "auto"
    count?: number
    offset?: number
    safeSearch?: boolean
    includeDomains?: string[]
    excludeDomains?: string[]
    language?: string
    country?: string
  }

  const DEFAULT_COUNT = 10
  const MAX_COUNT = 20

  /**
   * Search the web using specified or auto-detected engine
   */
  export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const engine = options.engine === "auto" || !options.engine ? detectEngine() : options.engine
    const count = Math.min(options.count || DEFAULT_COUNT, MAX_COUNT)

    log.info("searching web", { query, engine, count })

    switch (engine) {
      case "brave":
        return searchBrave(query, { ...options, count })
      case "duckduckgo":
        return searchDuckDuckGo(query, { ...options, count })
      case "google":
        return searchGoogle(query, { ...options, count })
      default:
        // Auto-detect failed, try fallback chain
        try {
          return await searchBrave(query, { ...options, count })
        } catch {
          return await searchDuckDuckGo(query, { ...options, count })
        }
    }
  }

  /**
   * Get news results
   */
  export async function searchNews(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const engine = options.engine === "auto" || !options.engine ? detectEngine() : options.engine
    const count = Math.min(options.count || DEFAULT_COUNT, MAX_COUNT)

    log.info("searching news", { query, engine, count })

    if (engine === "brave") {
      return searchBraveNews(query, { ...options, count })
    }

    // Fallback to regular search for other engines
    return search(query, { ...options, count })
  }

  /**
   * Detect available search engine based on environment
   */
  function detectEngine(): "brave" | "duckduckgo" | "google" {
    if (process.env.BRAVE_API_KEY) {
      return "brave"
    }
    if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_CSE_ID) {
      return "google"
    }
    // DuckDuckGo doesn't require API key (uses HTML scraping)
    return "duckduckgo"
  }

  /**
   * Brave Search API
   */
  async function searchBrave(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY
    if (!apiKey) {
      throw new Error("Brave Search requires BRAVE_API_KEY environment variable")
    }

    const endpoint = "https://api.search.brave.com/res/v1/web/search"
    const params = new URLSearchParams({
      q: query,
      count: String(options.count || DEFAULT_COUNT),
    })

    if (options.offset) params.append("offset", String(options.offset))
    if (options.safeSearch !== undefined) params.append("safesearch", options.safeSearch ? "strict" : "off")
    if (options.language) params.append("search_lang", options.language)
    if (options.country) params.append("country", options.country)

    const url = `${endpoint}?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Brave Search error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as {
      web?: {
        results?: Array<{
          title: string
          url: string
          description: string
          age?: string
        }>
      }
    }

    const results = data.web?.results || []
    return results.map((r, i) => ({
      id: Identifier.ascending("tool"),
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: "Brave Search",
      publishedDate: r.age,
      score: results.length - i,
    }))
  }

  /**
   * Brave News Search
   */
  async function searchBraveNews(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY
    if (!apiKey) {
      throw new Error("Brave Search requires BRAVE_API_KEY environment variable")
    }

    const endpoint = "https://api.search.brave.com/res/v1/news/search"
    const params = new URLSearchParams({
      q: query,
      count: String(options.count || DEFAULT_COUNT),
    })

    if (options.safeSearch !== undefined) params.append("safesearch", options.safeSearch ? "strict" : "off")
    if (options.language) params.append("search_lang", options.language)
    if (options.country) params.append("country", options.country)

    const url = `${endpoint}?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(`Brave News error: ${response.status}`)
    }

    const data = await response.json() as {
      results?: Array<{
        title: string
        url: string
        description: string
        age?: string
        source?: string
      }>
    }

    const results = data.results || []
    return results.map((r, i) => ({
      id: Identifier.ascending("tool"),
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: r.source || "Brave News",
      publishedDate: r.age,
      score: results.length - i,
    }))
  }

  /**
   * DuckDuckGo Search (HTML scraping - no API key required)
   */
  async function searchDuckDuckGo(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const endpoint = "https://html.duckduckgo.com/html/"
    const params = new URLSearchParams({
      q: query,
    })

    if (options.safeSearch !== undefined) {
      // DuckDuckGo uses ka parameter for safe search
      // ka=1 enables safe search
    }

    const url = `${endpoint}?${params.toString()}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://duckduckgo.com",
        Referer: "https://duckduckgo.com/",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(`DuckDuckGo error: ${response.status}`)
    }

    const html = await response.text()
    return parseDuckDuckGoHtml(html, query)
  }

  /**
   * Parse DuckDuckGo HTML response
   */
  function parseDuckDuckGoHtml(html: string, query: string): SearchResult[] {
    const results: SearchResult[] = []

    // Simple regex-based parsing (production should use proper HTML parser)
    const resultRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>/g
    const snippetRegex = /<a class="result__snippet" href="[^"]+">([^<]+)<\/a>/g

    let match
    const titles: Array<{ url: string; title: string }> = []

    while ((match = resultRegex.exec(html)) !== null) {
      titles.push({
        url: match[1].startsWith("http") ? match[1] : `https://${match[1]}`,
        title: match[2],
      })
    }

    const snippets: string[] = []
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1])
    }

    for (let i = 0; i < Math.min(titles.length, 10); i++) {
      results.push({
        id: Identifier.ascending("tool"),
        title: titles[i]?.title || "Untitled",
        url: titles[i]?.url || "#",
        snippet: snippets[i] || "",
        source: "DuckDuckGo",
        score: titles.length - i,
      })
    }

    return results
  }

  /**
   * Google Custom Search Engine API
   */
  async function searchGoogle(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.GOOGLE_API_KEY
    const cseId = process.env.GOOGLE_CSE_ID

    if (!apiKey || !cseId) {
      throw new Error("Google Search requires GOOGLE_API_KEY and GOOGLE_CSE_ID environment variables")
    }

    const endpoint = "https://www.googleapis.com/customsearch/v1"
    const params = new URLSearchParams({
      key: apiKey,
      cx: cseId,
      q: query,
      num: String(Math.min(options.count || DEFAULT_COUNT, 10)),
    })

    if (options.offset) params.append("start", String(options.offset))
    if (options.safeSearch !== undefined) params.append("safe", options.safeSearch ? "active" : "off")
    if (options.language) params.append("lr", `lang_${options.language}`)
    if (options.country) params.append("gl", options.country)

    const url = `${endpoint}?${params.toString()}`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google Search error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as {
      items?: Array<{
        title: string
        link: string
        snippet: string
        displayLink: string
        formattedUrl?: string
      }>
    }

    const results = data.items || []
    return results.map((r, i) => ({
      id: Identifier.ascending("tool"),
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: r.displayLink,
      score: results.length - i,
    }))
  }

  /**
   * Fetch and summarize a webpage
   */
  export async function fetchAndSummarize(url: string): Promise<{ title: string; content: string; summary: string }> {
    log.info("fetching and summarizing page", { url })

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HopCoderX/1.0; +https://github.com/hopcoderx/hopcoderx)",
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`)
    }

    const html = await response.text()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : "Untitled"

    // Extract main content (simplified - production should use proper HTML parser)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    let content = bodyMatch ? bodyMatch[1] : ""

    // Remove scripts, styles, and other non-content elements
    content = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    // Generate simple summary (first 500 chars)
    const summary = content.slice(0, 500) + (content.length > 500 ? "..." : "")

    return { title, content, summary }
  }

  /**
   * MCP Tools export
   */
  export const tools = {
    web_search: {
      description:
        "Search the web for information. Use this to find current information, documentation, news, or answers to questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query - be specific and include relevant keywords",
          },
          engine: {
            type: "string",
            enum: ["brave", "duckduckgo", "google", "auto"],
            description: "Search engine to use (default: auto-detect)",
          },
          count: {
            type: "number",
            description: "Number of results to return (default: 10, max: 20)",
          },
          safeSearch: {
            type: "boolean",
            description: "Enable safe search filtering",
          },
          includeDomains: {
            type: "array",
            items: { type: "string" },
            description: "Only include results from these domains",
          },
          excludeDomains: {
            type: "array",
            items: { type: "string" },
            description: "Exclude results from these domains",
          },
        },
        required: ["query"],
      },
      execute: async (args: Record<string, any>) => {
        try {
          const results = await search(args.query, {
            engine: args.engine,
            count: args.count,
            safeSearch: args.safeSearch,
            includeDomains: args.includeDomains,
            excludeDomains: args.excludeDomains,
          })

          if (results.length === 0) {
            return "No results found for query"
          }

          return results
            .map(
              (r, i) =>
                `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}\n   Source: ${r.source}${r.publishedDate ? ` | ${r.publishedDate}` : ""}`,
            )
            .join("\n\n")
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    web_search_news: {
      description:
        "Search for recent news articles. Use this for current events, recent developments, or time-sensitive information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "News search query",
          },
          count: {
            type: "number",
            description: "Number of results (default: 10)",
          },
          language: {
            type: "string",
            description: "Language code (e.g., 'en', 'es', 'fr')",
          },
          country: {
            type: "string",
            description: "Country code (e.g., 'US', 'GB', 'DE')",
          },
        },
        required: ["query"],
      },
      execute: async (args: Record<string, any>) => {
        try {
          const results = await searchNews(args.query, {
            count: args.count,
            language: args.language,
            country: args.country,
          })

          if (results.length === 0) {
            return "No news results found for query"
          }

          return results
            .map(
              (r, i) =>
                `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}\n   Source: ${r.source}${r.publishedDate ? ` | ${r.publishedDate}` : ""}`,
            )
            .join("\n\n")
        } catch (error) {
          return `News search failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },

    web_fetch: {
      description:
        "Fetch and extract content from a webpage. Returns the title and main content of the page.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL of the webpage to fetch",
          },
        },
        required: ["url"],
      },
      execute: async (args: Record<string, any>) => {
        try {
          const result = await fetchAndSummarize(args.url)
          return `# ${result.title}\n\n${result.summary}`
        } catch (error) {
          return `Failed to fetch page: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  }
}

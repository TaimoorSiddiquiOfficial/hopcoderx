/**
 * DuckDuckGo web search tool — no API key required.
 *
 * Uses the DDG HTML endpoint and parses results via regex.
 * Results are cached in-memory per query+options.
 */

import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html"
const DEFAULT_COUNT = 8
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const DDG_SAFE_SEARCH: Record<"strict" | "moderate" | "off", string> = {
  strict: "1",
  moderate: "-1",
  off: "-2",
}

type CacheEntry = { results: DdgResult[]; expiresAt: number }
const cache = new Map<string, CacheEntry>()

type DdgResult = { title: string; url: string; snippet: string }

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "--")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function decodeDdgUrl(rawUrl: string): string {
  try {
    const normalized = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl
    const parsed = new URL(normalized)
    const uddg = parsed.searchParams.get("uddg")
    if (uddg) return uddg
  } catch {}
  return rawUrl
}

function isBotChallenge(html: string): boolean {
  if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) return false
  return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(html)
}

function parseDdgHtml(html: string): DdgResult[] {
  const results: DdgResult[] = []
  const resultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi
  const nextResultRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")[^>]*>/i
  const snippetRegex = /<a\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*")[^>]*>([\s\S]*?)<\/a>/i

  for (const match of html.matchAll(resultRegex)) {
    const rawAttr = match[1] ?? ""
    const rawTitle = match[2] ?? ""
    const hrefMatch = /\bhref="([^"]*)"/i.exec(rawAttr)
    const rawUrl = hrefMatch?.[1] ?? ""
    const matchEnd = (match.index ?? 0) + match[0].length
    const trailing = html.slice(matchEnd)
    const nextIdx = trailing.search(nextResultRegex)
    const scoped = nextIdx >= 0 ? trailing.slice(0, nextIdx) : trailing
    const rawSnippet = snippetRegex.exec(scoped)?.[1] ?? ""

    const title = decodeHtmlEntities(stripHtml(rawTitle))
    const url = decodeDdgUrl(decodeHtmlEntities(rawUrl))
    const snippet = decodeHtmlEntities(stripHtml(rawSnippet))

    if (title && url) results.push({ title, url, snippet })
  }
  return results
}

export const DuckDuckGoSearchTool = Tool.define("duckduckgo_search", {
  description:
    "Search the web using DuckDuckGo. No API key required. Returns titles, URLs, and snippets for the query. Use when you need free web search without configuring external credentials.",
  parameters: z.object({
    query: z.string().describe("Search query"),
    count: z.number().min(1).max(10).optional().describe("Number of results (1-10, default 8)"),
    region: z.string().optional().describe("DuckDuckGo region code e.g. us-en, uk-en, de-de"),
    safeSearch: z.enum(["strict", "moderate", "off"]).optional().describe("SafeSearch level (default: moderate)"),
  }),
  async execute(params, ctx) {
    const count = Math.min(params.count ?? DEFAULT_COUNT, 10)
    const safeSearch = params.safeSearch ?? "moderate"
    const region = params.region

    const cacheKey = JSON.stringify({ q: params.query, count, region: region ?? "", safeSearch })
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      const output = formatResults(cached.results, params.query, true)
      return {
        title: `DDG: ${params.query}`,
        output,
        metadata: { resultCount: cached.results.length, cached: true },
      }
    }

    const url = new URL(DDG_HTML_ENDPOINT)
    url.searchParams.set("q", params.query)
    if (region) url.searchParams.set("kl", region)
    url.searchParams.set("kp", DDG_SAFE_SEARCH[safeSearch])

    const { signal, clearTimeout } = abortAfterAny(DEFAULT_TIMEOUT_MS, ctx.abort)

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal,
      })
      clearTimeout()

      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText)
        throw new Error(`DuckDuckGo search error (${response.status}): ${detail.slice(0, 500)}`)
      }

      const html = await response.text()

      if (isBotChallenge(html)) {
        throw new Error("DuckDuckGo returned a bot-detection challenge. Try again later.")
      }

      const results = parseDdgHtml(html).slice(0, count)
      cache.set(cacheKey, { results, expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS })

      const output = formatResults(results, params.query, false)
      return {
        title: `DDG: ${params.query}`,
        output,
        metadata: { resultCount: results.length, cached: false },
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("DuckDuckGo search timed out")
      }
      throw err
    }
  },
})

function formatResults(results: DdgResult[], query: string, fromCache: boolean): string {
  if (results.length === 0) {
    return `No results found for: "${query}". Try rephrasing your query.`
  }
  const cacheNote = fromCache ? " (cached)" : ""
  const lines = [`DuckDuckGo results for: "${query}"${cacheNote}`, ""]
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`${i + 1}. **${r.title}**`)
    lines.push(`   ${r.url}`)
    if (r.snippet) lines.push(`   ${r.snippet}`)
    lines.push("")
  }
  return lines.join("\n").trim()
}

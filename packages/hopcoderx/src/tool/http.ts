/**
 * HTTP API testing tool.
 *
 * Make HTTP requests with full control over method, headers, body, auth.
 * Returns status, headers, body, and timing — ideal for testing APIs.
 */

import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const

function redactAuth(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (/authorization|api-key|x-api-key|token/i.test(k)) {
      out[k] = v.slice(0, 8) + "…[redacted]"
    } else {
      out[k] = v
    }
  }
  return out
}

export const HttpTool = Tool.define("http", {
  description:
    "Make HTTP requests (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Use for testing REST APIs, webhooks, or fetching remote resources. Returns status code, headers, body, and timing. Supports JSON, form-data, and raw body types.",
  parameters: z.object({
    method: z.enum(METHODS).default("GET").describe("HTTP method"),
    url: z.string().url().describe("Full URL to request"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers as key-value pairs"),
    body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("Request body — string or JSON object"),
    body_type: z
      .enum(["json", "form", "text", "none"])
      .optional()
      .default("json")
      .describe("Body encoding: json (default), form (application/x-www-form-urlencoded), text, none"),
    bearer_token: z.string().optional().describe("Bearer token for Authorization header"),
    basic_auth: z
      .object({ username: z.string(), password: z.string() })
      .optional()
      .describe("Basic auth credentials"),
    timeout_ms: z.number().optional().default(30000).describe("Request timeout in milliseconds (default 30s)"),
    follow_redirects: z.boolean().optional().default(true).describe("Follow HTTP redirects (default true)"),
    include_response_headers: z.boolean().optional().default(false).describe("Include response headers in output"),
  }),
  async execute(params, ctx) {
    // Prevent SSRF via non-HTTP schemes (file://, ftp://, etc.)
    if (!/^https?:\/\//i.test(params.url)) {
      throw new Error(`Blocked: only http:// and https:// URLs are allowed. Got: ${params.url}`)
    }

    await ctx.ask({
      permission: "http",
      patterns: [params.url],
      always: [],
      metadata: { method: params.method, url: params.url },
    })

    const headers: Record<string, string> = { ...(params.headers ?? {}) }

    if (params.bearer_token) {
      headers["Authorization"] = `Bearer ${params.bearer_token}`
    } else if (params.basic_auth) {
      const encoded = Buffer.from(`${params.basic_auth.username}:${params.basic_auth.password}`).toString("base64")
      headers["Authorization"] = `Basic ${encoded}`
    }

    const NO_BODY_METHODS = new Set(["GET", "HEAD", "OPTIONS", "DELETE"])
    let body: BodyInit | undefined
    if (params.body !== undefined && !NO_BODY_METHODS.has(params.method)) {
      const bodyType = params.body_type ?? "json"
      if (bodyType === "json") {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json"
        body = typeof params.body === "string" ? params.body : JSON.stringify(params.body)
      } else if (bodyType === "form") {
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        const data = typeof params.body === "string" ? params.body : new URLSearchParams(params.body as Record<string, string>).toString()
        body = data
      } else {
        body = typeof params.body === "string" ? params.body : JSON.stringify(params.body)
      }
    }

    const { signal, clearTimeout } = abortAfterAny(params.timeout_ms ?? 30000, ctx.abort)
    const startedAt = Date.now()

    try {
      const response = await fetch(params.url, {
        method: params.method,
        headers,
        body,
        signal,
        redirect: params.follow_redirects ? "follow" : "manual",
      })
      clearTimeout()
      const durationMs = Date.now() - startedAt

      const contentType = response.headers.get("content-type") ?? ""
      let responseBody: string
      if (contentType.includes("application/json")) {
        const raw = await response.text()
        try {
          responseBody = JSON.stringify(JSON.parse(raw), null, 2)
        } catch {
          responseBody = raw
        }
      } else {
        responseBody = await response.text()
      }
      if (responseBody.length > 50_000) {
        responseBody = responseBody.slice(0, 50_000) + "\n…[truncated]"
      }

      const statusIcon = response.ok ? "✅" : "❌"
      const lines = [
        `${statusIcon} ${response.status} ${response.statusText}  (${durationMs}ms)`,
        `URL: ${params.method} ${params.url}`,
      ]

      if (params.include_response_headers) {
        lines.push("\n**Response Headers:**")
        response.headers.forEach((v, k) => lines.push(`  ${k}: ${v}`))
      }

      lines.push("\n**Body:**")
      lines.push(responseBody || "(empty)")

      return {
        title: `${params.method} ${params.url} → ${response.status}`,
        output: lines.join("\n"),
        metadata: {
          status: response.status,
          ok: response.ok,
          durationMs,
          contentType,
          requestHeaders: redactAuth(headers),
        },
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`HTTP request timed out after ${params.timeout_ms}ms`)
      }
      throw err
    }
  },
})

/**
 * Headless browser automation tool.
 *
 * Navigate, click, type, extract, fill forms and take screenshots using
 * Playwright (already a dependency via visualdebug tool).
 */

import z from "zod"
import { Tool } from "./tool"

const ACTIONS = ["navigate", "click", "type", "extract", "screenshot", "fill_form", "wait", "scroll", "evaluate"] as const

type Meta = Record<string, unknown>

export const BrowserTool= Tool.define("browser", {
  description:
    "Automate a headless browser: navigate to URLs, click elements, type text, fill forms, extract content, take screenshots, wait for selectors, scroll the page, or evaluate JavaScript. Uses Playwright under the hood. Perfect for testing web UIs, scraping, or automating web tasks.",
  parameters: z.object({
    url: z.string().url().optional().describe("URL to navigate to (required for navigate action; optional for others if continuing session)"),
    action: z.enum(ACTIONS).default("navigate").describe(
      "navigate: open URL | click: click element | type: type into element | extract: extract text/HTML | screenshot: capture screenshot | fill_form: fill multiple fields | wait: wait for selector | scroll: scroll page | evaluate: run JS",
    ),
    selector: z.string().optional().describe("CSS selector or text selector (e.g. 'button:text(\"Submit\")', '#login-form', '.nav-link')"),
    text: z.string().optional().describe("Text to type or text selector content"),
    script: z.string().optional().describe("JavaScript to evaluate in page context"),
    fields: z
      .array(z.object({ selector: z.string(), value: z.string() }))
      .optional()
      .describe("Form fields for fill_form action: [{selector: '#email', value: 'user@example.com'}]"),
    wait_for: z.string().optional().describe("CSS selector to wait for before performing action"),
    timeout_ms: z.number().optional().default(30000).describe("Action timeout in milliseconds"),
    extract_attribute: z.string().optional().describe("Attribute to extract (for extract action, e.g. 'href', 'src'). Defaults to text content."),
    scroll_direction: z.enum(["down", "up", "bottom", "top"]).optional().default("down"),
    scroll_amount: z.number().optional().default(500).describe("Pixels to scroll"),
    all_matches: z.boolean().optional().default(false).describe("For extract: return all matching elements (not just first)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.url ?? params.action],
      always: ["screenshot", "extract", "evaluate"],
      metadata: { action: params.action, url: params.url },
    })

    let pw: any
    try {
      // @ts-ignore - playwright-core is an optional peer dependency
      pw = await import("playwright-core")
    } catch {
      return {
        title: "browser: playwright-core not installed",
        output: [
          "playwright-core is not installed. Install it with:",
          "  bun add playwright-core",
          "Then install a browser:",
          "  bunx playwright install chromium",
        ].join("\n"),
        metadata: {} as Meta,
      }
    }

    let browser: any
    try {
      browser = await pw.chromium.launch({ headless: true })
    } catch {
      return {
        title: "browser: no browser available",
        output: [
          "No Chromium browser found. Install one with:",
          "  bunx playwright install chromium",
        ].join("\n"),
        metadata: {} as Meta,
      }
    }

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

      if (params.url) {
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: params.timeout_ms })
      }

      if (params.wait_for) {
        await page.waitForSelector(params.wait_for, { timeout: params.timeout_ms })
      }

      const action = params.action

      if (action === "navigate") {
        const title = await page.title()
        const url = page.url()
        return {
          title: `browser → ${url}`,
          output: `✅ Navigated to: ${url}\nPage title: ${title}`,
          metadata: { url, pageTitle: title } as Meta,
        }
      }

      if (action === "click") {
        if (!params.selector) return { title: "browser click", output: "Error: `selector` is required", metadata: {} as Meta }
        await page.click(params.selector, { timeout: params.timeout_ms })
        await page.waitForLoadState("networkidle").catch(() => {})
        return { title: `browser click — ${params.selector}`, output: `✅ Clicked: ${params.selector}`, metadata: {} as Meta }
      }

      if (action === "type") {
        if (!params.selector) return { title: "browser type", output: "Error: `selector` is required", metadata: {} as Meta }
        await page.fill(params.selector, params.text ?? "")
        return { title: `browser type — ${params.selector}`, output: `✅ Typed into: ${params.selector}`, metadata: {} as Meta }
      }

      if (action === "fill_form") {
        if (!params.fields?.length) return { title: "browser fill_form", output: "Error: `fields` is required", metadata: {} as Meta }
        for (const { selector, value } of params.fields) {
          await page.fill(selector, value, { timeout: params.timeout_ms })
        }
        return {
          title: "browser fill_form",
          output: `✅ Filled ${params.fields.length} field(s):\n${params.fields.map((f) => `  ${f.selector}`).join("\n")}`,
          metadata: { fieldsCount: params.fields.length } as Meta,
        }
      }

      if (action === "extract") {
        const attr = params.extract_attribute
        if (params.all_matches) {
          const results = await page.$$eval(
            params.selector ?? "body",
            (els: Element[], a: string | undefined) => els.map((el) => (a ? (el as HTMLElement).getAttribute(a) : (el as HTMLElement).innerText?.trim())).filter(Boolean),
            attr,
          )
          return {
            title: `browser extract (${results.length} matches)`,
            output: results.join("\n"),
            metadata: { count: results.length } as Meta,
          }
        } else {
          const result = attr
            ? await page.getAttribute(params.selector ?? "body", attr)
            : await page.innerText(params.selector ?? "body").catch(() => page.textContent(params.selector ?? "body"))
          return { title: "browser extract", output: result ?? "(empty)", metadata: {} as Meta }
        }
      }

      if (action === "screenshot") {
        const screenshotBuf = params.selector
          ? await page.locator(params.selector).screenshot({ timeout: params.timeout_ms })
          : await page.screenshot({ fullPage: true, timeout: params.timeout_ms })
        const base64 = screenshotBuf.toString("base64")
        return {
          title: `browser screenshot`,
          output: `Screenshot captured (${screenshotBuf.length} bytes)`,
          metadata: { sizeBytes: screenshotBuf.length } as Meta,
          attachments: [{ type: "file" as const, mime: "image/png", filename: "screenshot.png", url: `data:image/png;base64,${base64}` }],
        }
      }

      if (action === "wait") {
        if (!params.selector && !params.wait_for) return { title: "browser wait", output: "Error: `selector` or `wait_for` required", metadata: {} as Meta }
        const sel = params.selector ?? params.wait_for!
        await page.waitForSelector(sel, { timeout: params.timeout_ms })
        return { title: `browser wait — ${sel}`, output: `✅ Element appeared: ${sel}`, metadata: {} as Meta }
      }

      if (action === "scroll") {
        const dir = params.scroll_direction ?? "down"
        if (dir === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        else if (dir === "top") await page.evaluate(() => window.scrollTo(0, 0))
        else if (dir === "down") await page.evaluate((amt: number) => window.scrollBy(0, amt), params.scroll_amount ?? 500)
        else await page.evaluate((amt: number) => window.scrollBy(0, -amt), params.scroll_amount ?? 500)
        return { title: "browser scroll", output: `✅ Scrolled ${dir}`, metadata: {} as Meta }
      }

      if (action === "evaluate") {
        if (!params.script) return { title: "browser evaluate", output: "Error: `script` is required", metadata: {} as Meta }
        const result = await page.evaluate(params.script)
        return {
          title: "browser evaluate",
          output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          metadata: {} as Meta,
        }
      }

      return { title: "browser", output: "Unknown action", metadata: {} as Meta }
    } finally {
      await browser.close()
    }
  },
})

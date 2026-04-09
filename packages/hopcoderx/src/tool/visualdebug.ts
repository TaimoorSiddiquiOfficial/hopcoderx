import { Tool } from "./tool"
import DESCRIPTION from "./visualdebug.txt"
import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.visualdebug" })

const parameters = z.object({
  url: z.string().describe("The URL to navigate to"),
  evaluate: z.string().optional().describe("JavaScript to evaluate in the page context"),
  selector: z.string().optional().describe("CSS selector to screenshot instead of full page"),
  wait_for: z.string().optional().describe("CSS selector to wait for before capturing"),
  inspect_dom: z.boolean().optional().describe("Extract DOM structure (tag, id, classes) of key elements"),
  network: z.boolean().optional().describe("Capture network requests made during page load"),
  accessibility: z.boolean().optional().describe("Run accessibility audit using CDP AXTree"),
  performance: z.boolean().optional().describe("Collect Lighthouse-style performance metrics via CDP"),
})

type Meta = Record<string, string | number | boolean | undefined>

// ─── CDP helpers ─────────────────────────────────────────────────────────────

interface NetworkEntry {
  url: string
  method: string
  status: number
  type: string
  duration: number
}

interface DomNode {
  tag: string
  id?: string
  classes?: string[]
  text?: string
  children?: number
}

async function collectCDPData(
  page: any,
  opts: { network?: boolean; dom?: boolean; accessibility?: boolean; performance?: boolean },
): Promise<{
  networkLog: NetworkEntry[]
  domSummary: DomNode[]
  a11yIssues: string[]
  perfMetrics: Record<string, number>
}> {
  const networkLog: NetworkEntry[] = []
  const a11yIssues: string[] = []
  const perfMetrics: Record<string, number> = {}
  const domSummary: DomNode[] = []

  // Network capture via Playwright route interception
  if (opts.network) {
    const timings = new Map<string, number>()
    page.on("request", (req: any) => timings.set(req.url(), Date.now()))
    page.on("response", (res: any) => {
      const start = timings.get(res.url()) ?? Date.now()
      networkLog.push({
        url: res.url().length > 120 ? res.url().slice(0, 120) + "…" : res.url(),
        method: res.request().method(),
        status: res.status(),
        type: res.request().resourceType(),
        duration: Date.now() - start,
      })
    })
  }

  // Performance metrics via CDP
  if (opts.performance) {
    try {
      const client = await page.context().newCDPSession(page)
      await client.send("Performance.enable")
      const { metrics } = await client.send("Performance.getMetrics")
      for (const m of metrics as { name: string; value: number }[]) {
        perfMetrics[m.name] = m.value
      }
    } catch {
      // CDP unavailable — skip
    }
  }

  // DOM summary
  if (opts.dom) {
    try {
      const nodes: DomNode[] = await page.evaluate(() => {
        const result: DomNode[] = []
        const els = document.querySelectorAll("h1,h2,h3,nav,main,header,footer,section,article,[id]")
        for (const el of Array.from(els).slice(0, 40)) {
          result.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: el.className ? String(el.className).split(" ").filter(Boolean) : undefined,
            text: (el.textContent?.trim() ?? "").slice(0, 60) || undefined,
            children: el.children.length,
          })
        }
        return result
      })
      domSummary.push(...nodes)
    } catch {
      // evaluation failed — skip
    }
  }

  // Accessibility via CDP AXTree
  if (opts.accessibility) {
    try {
      const client = await page.context().newCDPSession(page)
      const { nodes } = await client.send("Accessibility.getFullAXTree") as { nodes: any[] }
      for (const node of nodes) {
        const name = node.name?.value ?? ""
        const role = node.role?.value ?? ""
        // Flag missing names on interactive elements
        if (
          ["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox"].includes(role) &&
          !name
        ) {
          a11yIssues.push(`Missing accessible name on <${role}>`)
        }
        // Flag images without alt text
        if (role === "img" && !name) {
          a11yIssues.push("Image missing alt text")
        }
      }
    } catch {
      // CDP unavailable — skip
    }
  }

  return { networkLog, domSummary, a11yIssues, perfMetrics }
}

// ─── Tool definition ─────────────────────────────────────────────────────────

export const VisualDebugTool = Tool.define<typeof parameters, Meta>("visualdebug", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params, ctx) {
      let pw: any
      try {
        // @ts-ignore - playwright-core is an optional peer dependency
        pw = await import("playwright-core")
      } catch {
        return {
          title: "Visual debug: playwright-core not installed",
          metadata: {} as Meta,
          output: [
            "playwright-core is not installed. Install it with:",
            "  bun add playwright-core",
            "Then install a browser:",
            "  bunx playwright install chromium",
          ].join("\n"),
        }
      }

      let browser: any
      try {
        browser = await pw.chromium.launch({ headless: true })
      } catch {
        return {
          title: "Visual debug: no browser available",
          metadata: {} as Meta,
          output: [
            "No Chromium browser found. Install one with:",
            "  bunx playwright install chromium",
          ].join("\n"),
        }
      }

      const consoleErrors: string[] = []
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

        page.on("console", (msg: any) => {
          if (msg.type() === "error") consoleErrors.push(msg.text())
        })
        page.on("pageerror", (err: any) => consoleErrors.push(String(err)))

        // Register network listeners BEFORE navigation
        const timings = new Map<string, number>()
        const networkLog: NetworkEntry[] = []
        if (params.network) {
          page.on("request", (req: any) => timings.set(req.url(), Date.now()))
          page.on("response", (res: any) => {
            const start = timings.get(res.url()) ?? Date.now()
            networkLog.push({
              url: res.url().length > 120 ? res.url().slice(0, 120) + "…" : res.url(),
              method: res.request().method(),
              status: res.status(),
              type: res.request().resourceType(),
              duration: Date.now() - start,
            })
          })
        }

        log.info("visualdebug: navigating", { url: params.url })
        await page.goto(params.url, { waitUntil: "networkidle", timeout: 30_000 })

        if (params.wait_for) {
          await page.waitForSelector(params.wait_for, { timeout: 10_000 })
        }

        const title = await page.title()
        const url = page.url()

        // Collect CDP data post-load
        const cdpResult = await collectCDPData(page, {
          network: false, // network captured via event listeners above
          dom: params.inspect_dom,
          accessibility: params.accessibility,
          performance: params.performance,
        })

        let evalResult = ""
        if (params.evaluate) {
          try {
            const raw = await page.evaluate(params.evaluate)
            evalResult = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)
          } catch (err) {
            evalResult = `Evaluation error: ${String(err)}`
          }
        }

        let screenshot: Buffer
        if (params.selector) {
          const el = await page.$(params.selector)
          if (!el) {
            return {
              title: "Visual debug: selector not found",
              metadata: { url, pageTitle: title } as Meta,
              output: `Selector "${params.selector}" not found on page ${url}`,
            }
          }
          screenshot = await el.screenshot() as Buffer
        } else {
          screenshot = await page.screenshot({ fullPage: true }) as Buffer
        }

        // Build output
        const sections: string[] = [
          `Page: ${title}`,
          `URL: ${url}`,
        ]

        // Console errors
        if (consoleErrors.length > 0) {
          sections.push(`\nConsole errors (${consoleErrors.length}):`)
          sections.push(...consoleErrors.slice(0, 10).map((e) => `  - ${e}`))
        } else {
          sections.push("No console errors ✓")
        }

        // Eval result
        if (evalResult) sections.push(`\nEvaluation result:\n${evalResult}`)

        // Network requests
        if (params.network && networkLog.length > 0) {
          sections.push(`\nNetwork requests (${networkLog.length}):`)
          const slowOrError = networkLog.filter((r) => r.status >= 400 || r.duration > 1000)
          if (slowOrError.length > 0) {
            sections.push("  ⚠ Slow/error requests:")
            for (const r of slowOrError.slice(0, 15)) {
              sections.push(`    [${r.status}] ${r.method} ${r.url} (${r.duration}ms)`)
            }
          }
          const ok = networkLog.filter((r) => r.status < 400)
          sections.push(`  ${ok.length} OK · ${networkLog.length - ok.length} errors`)
        }

        // DOM summary
        if (params.inspect_dom && cdpResult.domSummary.length > 0) {
          sections.push(`\nDOM structure (${cdpResult.domSummary.length} key elements):`)
          for (const n of cdpResult.domSummary.slice(0, 20)) {
            const id = n.id ? `#${n.id}` : ""
            const cls = n.classes?.slice(0, 3).map((c) => `.${c}`).join("") ?? ""
            sections.push(`  <${n.tag}${id}${cls}> ${n.text ? `"${n.text}"` : ""} (${n.children ?? 0} children)`)
          }
        }

        // Accessibility issues
        if (params.accessibility) {
          if (cdpResult.a11yIssues.length === 0) {
            sections.push("\nAccessibility: No major issues found ✓")
          } else {
            sections.push(`\nAccessibility issues (${cdpResult.a11yIssues.length}):`)
            const counts = new Map<string, number>()
            for (const iss of cdpResult.a11yIssues) counts.set(iss, (counts.get(iss) ?? 0) + 1)
            for (const [iss, count] of counts) sections.push(`  - ${iss}${count > 1 ? ` (×${count})` : ""}`)
          }
        }

        // Performance metrics
        if (params.performance && Object.keys(cdpResult.perfMetrics).length > 0) {
          const keyMetrics = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "JSHeapUsedSize"]
          sections.push("\nPerformance metrics:")
          for (const key of keyMetrics) {
            if (cdpResult.perfMetrics[key] !== undefined) {
              const v = cdpResult.perfMetrics[key]
              const val = key.includes("HeapUsedSize") ? `${(v / 1024 / 1024).toFixed(1)} MB` : `${(v * 1000).toFixed(1)} ms`
              sections.push(`  ${key}: ${val}`)
            }
          }
        }

        sections.push(`\nScreenshot captured (${screenshot.length} bytes)`)

        return {
          title: `Visual debug: ${title}`,
          metadata: {
            url,
            pageTitle: title,
            consoleErrors: consoleErrors.length,
            networkRequests: networkLog.length,
            a11yIssues: cdpResult.a11yIssues.length,
          } as Meta,
          output: sections.filter(Boolean).join("\n"),
          attachments: [
            {
              type: "file" as const,
              url: `data:image/png;base64,${screenshot.toString("base64")}`,
              filename: "screenshot.png",
              mime: "image/png",
            },
          ],
        }
      } catch (err) {
        log.error("visualdebug: failed", { error: String(err) })
        return {
          title: "Visual debug: navigation failed",
          metadata: { url: params.url, error: String(err) } as Meta,
          output: `Failed to navigate to ${params.url}: ${String(err)}`,
        }
      } finally {
        await browser.close().catch(() => {})
      }
    },
  }
})

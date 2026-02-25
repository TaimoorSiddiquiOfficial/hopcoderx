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
})

type Meta = Record<string, string | number | undefined>

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

      const errors: string[] = []
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

        page.on("console", (msg: any) => {
          if (msg.type() === "error") errors.push(msg.text())
        })
        page.on("pageerror", (err: any) => errors.push(String(err)))

        log.info("visualdebug: navigating", { url: params.url })
        await page.goto(params.url, { waitUntil: "networkidle", timeout: 30_000 })

        if (params.wait_for) {
          await page.waitForSelector(params.wait_for, { timeout: 10_000 })
        }

        const title = await page.title()
        const url = page.url()

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

        const output = [
          `Page: ${title}`,
          `URL: ${url}`,
          errors.length > 0 ? `Console errors (${errors.length}):` : "No console errors",
          ...errors.map((e) => `  - ${e}`),
          evalResult ? `\nEvaluation result:\n${evalResult}` : "",
          `\nScreenshot captured (${screenshot.length} bytes, base64-encoded in attachments)`,
        ]
          .filter(Boolean)
          .join("\n")

        return {
          title: `Visual debug: ${title}`,
          metadata: {
            url,
            pageTitle: title,
            consoleErrors: errors.length,
          } as Meta,
          output,
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

/**
 * Canvas tool for HopCoderX — agent-driven visual workspace via A2UI protocol.
 *
 * Actions:
 *   present   — Open a URL in the canvas panel
 *   hide      — Hide the canvas panel
 *   navigate  — Navigate the canvas to a URL
 *   eval      — Run JavaScript in the canvas context
 *   snapshot  — Capture a screenshot of the canvas
 *   a2ui_push — Push A2UI JSONL events (progress, tables, code, etc.)
 *   a2ui_reset — Clear the A2UI canvas
 *
 * Configuration:
 *   HOPCODERX_CANVAS_URL=http://localhost:3741   (canvas host URL)
 *   HOPCODERX_CANVAS_TOKEN=<secret>              (optional auth token)
 */

import z from "zod"
import { Tool } from "./tool"
import { CanvasClient } from "../canvas/index"

type Meta = Record<string, string | number | boolean | undefined>

const parameters = z.object({
  action: z
    .enum(["present", "hide", "navigate", "eval", "snapshot", "a2ui_push", "a2ui_reset"])
    .describe("Canvas action to perform"),
  url: z.string().optional().describe("URL to present or navigate to (required for present/navigate)"),
  javaScript: z.string().optional().describe("JavaScript code to evaluate in canvas (required for eval)"),
  jsonl: z.string().optional().describe("A2UI JSONL events string, one JSON object per line (required for a2ui_push)"),
  format: z.enum(["png", "jpeg"]).optional().default("png").describe("Screenshot format (snapshot only)"),
  maxWidth: z.number().optional().describe("Max screenshot width in pixels (snapshot only)"),
  x: z.number().optional().describe("Canvas x position (present only)"),
  y: z.number().optional().describe("Canvas y position (present only)"),
  width: z.number().optional().describe("Canvas width (present only)"),
  height: z.number().optional().describe("Canvas height (present only)"),
})

export const CanvasTool = Tool.define<typeof parameters, Meta>("canvas", {
  description:
    "Control the HopCoderX canvas panel (A2UI visual workspace). Present URLs, run JS, push rich UI events, or capture screenshots.",
  parameters,
  async execute(params, ctx) {
    const client = new CanvasClient()

    // Check canvas host connectivity first
    const alive = await client.ping()
    if (!alive) {
      const url = process.env.HOPCODERX_CANVAS_URL ?? "http://localhost:3741"
      return {
        title: "Canvas: host not reachable",
        metadata: {} as Meta,
        output: `Canvas host not reachable at ${url}.\nSet HOPCODERX_CANVAS_URL to the correct address or start the canvas host.`,
      }
    }

    try {
      switch (params.action) {
        case "present": {
          if (!params.url) throw new Error("canvas: url required for action=present")
          const placement =
            params.x != null || params.y != null || params.width != null || params.height != null
              ? { x: params.x, y: params.y, width: params.width, height: params.height }
              : undefined
          await client.present(params.url, placement)
          return { title: "Canvas: presented", metadata: { url: params.url } as Meta, output: `Presenting ${params.url} in canvas.` }
        }

        case "hide": {
          await client.hide()
          return { title: "Canvas: hidden", metadata: {} as Meta, output: "Canvas panel hidden." }
        }

        case "navigate": {
          const target = params.url
          if (!target) throw new Error("canvas: url required for action=navigate")
          await client.navigate(target)
          return { title: "Canvas: navigated", metadata: { url: target } as Meta, output: `Canvas navigated to ${target}.` }
        }

        case "eval": {
          if (!params.javaScript) throw new Error("canvas: javaScript required for action=eval")
          const result = await client.eval(params.javaScript)
          return {
            title: "Canvas: eval result",
            metadata: {} as Meta,
            output: result || "(no return value)",
          }
        }

        case "snapshot": {
          const snap = await client.snapshot(params.format ?? "png", params.maxWidth)
          return {
            title: "Canvas: snapshot",
            metadata: { format: snap.format, width: snap.width, height: snap.height } as Meta,
            output: `Screenshot captured: ${snap.width}×${snap.height} ${snap.format.toUpperCase()}`,
            attachments: [
              {
                type: "file" as const,
                filename: `canvas-snapshot.${snap.format}`,
                mime: snap.mimeType,
                url: `data:${snap.mimeType};base64,${snap.base64}`,
              },
            ],
          }
        }

        case "a2ui_push": {
          if (!params.jsonl) throw new Error("canvas: jsonl required for action=a2ui_push")
          const lines = params.jsonl.trim().split("\n").filter(Boolean)
          await client.a2uiPushJsonl(params.jsonl)
          return {
            title: "Canvas: A2UI events pushed",
            metadata: { events: lines.length } as Meta,
            output: `Pushed ${lines.length} A2UI event(s) to canvas.`,
          }
        }

        case "a2ui_reset": {
          await client.a2uiReset()
          return { title: "Canvas: A2UI reset", metadata: {} as Meta, output: "Canvas A2UI state reset." }
        }

        default:
          throw new Error(`Unknown canvas action: ${params.action}`)
      }
    } catch (err: any) {
      return {
        title: "Canvas: error",
        metadata: { action: params.action } as Meta,
        output: `Canvas error (${params.action}): ${err.message}`,
      }
    }
  },
})

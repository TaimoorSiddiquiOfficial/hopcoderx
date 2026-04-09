/**
 * Canvas A2UI module for HopCoderX.
 *
 * A2UI (Agent-to-UI) is a JSONL-based protocol for agent-driven visual workspaces.
 * Inspired by OpenClaw's canvas-host architecture.
 *
 * The agent sends JSONL commands to a canvas host (local or remote) which renders
 * them in a browser/native UI. This enables the agent to:
 *   - Present web content in a visual panel
 *   - Navigate the panel URL
 *   - Evaluate JavaScript in the canvas context
 *   - Take screenshots for visual debugging
 *   - Push rich A2UI UI events (e.g. show charts, tables, progress bars)
 *
 * Canvas host:
 *   HOPCODERX_CANVAS_URL=http://localhost:3741   (default)
 *   HOPCODERX_CANVAS_TOKEN=<secret>               (optional auth)
 *
 * A2UI event format (JSONL, one JSON object per line):
 *   { "type": "text", "content": "Hello" }
 *   { "type": "progress", "value": 0.5, "label": "Building…" }
 *   { "type": "table", "columns": ["Name","Status"], "rows": [["test","pass"]] }
 *   { "type": "code", "language": "typescript", "content": "const x = 1" }
 *   { "type": "image", "src": "data:image/png;base64,…" }
 *   { "type": "reset" }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanvasAction = "present" | "hide" | "navigate" | "eval" | "snapshot" | "a2ui_push" | "a2ui_reset"

export interface CanvasHostConfig {
  url?: string
  token?: string
  timeoutMs?: number
}

export interface SnapshotResult {
  base64: string
  format: "png" | "jpeg"
  width: number
  height: number
  mimeType: string
}

/** A2UI event types supported by the canvas renderer */
export type A2UiEvent =
  | { type: "text"; content: string; role?: "agent" | "system" }
  | { type: "code"; language: string; content: string; filename?: string }
  | { type: "progress"; value: number; label?: string; done?: boolean }
  | { type: "table"; columns: string[]; rows: (string | number)[][] }
  | { type: "image"; src: string; alt?: string; width?: number }
  | { type: "link"; href: string; label?: string }
  | { type: "error"; message: string; detail?: string }
  | { type: "reset" }

// ─── Canvas client ────────────────────────────────────────────────────────────

export class CanvasClient {
  private readonly url: string
  private readonly token: string | undefined
  private readonly timeoutMs: number

  constructor(config?: CanvasHostConfig) {
    this.url = (config?.url ?? process.env.HOPCODERX_CANVAS_URL ?? "http://localhost:3741").replace(/\/$/, "")
    this.token = config?.token ?? process.env.HOPCODERX_CANVAS_TOKEN
    this.timeoutMs = config?.timeoutMs ?? 10_000
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (this.token) h["Authorization"] = `Bearer ${this.token}`
    return h
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Canvas host error ${res.status}: ${text}`)
    }
    const ct = res.headers.get("content-type") ?? ""
    return ct.includes("application/json") ? res.json() : res.text()
  }

  /** Present a URL in the canvas panel */
  async present(url: string, placement?: { x?: number; y?: number; width?: number; height?: number }): Promise<void> {
    await this.post("/canvas/present", { url, placement })
  }

  /** Hide the canvas panel */
  async hide(): Promise<void> {
    await this.post("/canvas/hide", {})
  }

  /** Navigate the canvas to a new URL */
  async navigate(url: string): Promise<void> {
    await this.post("/canvas/navigate", { url })
  }

  /** Evaluate JavaScript in the canvas context and return the result */
  async eval(javaScript: string): Promise<string> {
    const res = await this.post("/canvas/eval", { javaScript }) as { result?: string }
    return res?.result ?? ""
  }

  /** Take a screenshot of the current canvas view */
  async snapshot(format: "png" | "jpeg" = "png", maxWidth?: number): Promise<SnapshotResult> {
    const res = await this.post("/canvas/snapshot", { format, maxWidth }) as {
      base64: string
      format: "png" | "jpeg"
      width: number
      height: number
    }
    return {
      ...res,
      mimeType: res.format === "jpeg" ? "image/jpeg" : "image/png",
    }
  }

  /** Push A2UI events to the canvas renderer */
  async a2uiPush(events: A2UiEvent[]): Promise<void> {
    const jsonl = events.map((e) => JSON.stringify(e)).join("\n")
    await this.post("/canvas/a2ui/push", { jsonl })
  }

  /** Push raw JSONL string to the canvas renderer */
  async a2uiPushJsonl(jsonl: string): Promise<void> {
    await this.post("/canvas/a2ui/push", { jsonl })
  }

  /** Reset the A2UI canvas to a blank state */
  async a2uiReset(): Promise<void> {
    await this.post("/canvas/a2ui/reset", {})
  }

  /** Check if the canvas host is reachable */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Send a structured A2UI event to the default canvas */
export async function pushA2Ui(...events: A2UiEvent[]): Promise<void> {
  const client = new CanvasClient()
  await client.a2uiPush(events)
}

/** Build a progress event */
export function progressEvent(value: number, label?: string, done = false): A2UiEvent {
  return { type: "progress", value: Math.max(0, Math.min(1, value)), label, done }
}

/** Build a code block event */
export function codeEvent(content: string, language = "typescript", filename?: string): A2UiEvent {
  return { type: "code", language, content, filename }
}

/** Build a table event */
export function tableEvent(columns: string[], rows: (string | number)[][]): A2UiEvent {
  return { type: "table", columns, rows }
}

// ─── Singleton default client ─────────────────────────────────────────────────

export const canvas = new CanvasClient()

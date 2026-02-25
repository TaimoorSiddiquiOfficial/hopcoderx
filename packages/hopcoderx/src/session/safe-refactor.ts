import { Log } from "@/util/log"
import { MessageV2 } from "./message-v2"
import { Snapshot } from "@/snapshot"
import { Config } from "@/config/config"

export namespace SafeRefactor {
  const log = Log.create({ service: "session.safe-refactor" })
  const retries: Record<string, number> = {}

  export function config() {
    return Config.get().then((c) => c.experimental?.safe_refactor)
  }

  export async function enabled() {
    const cfg = await config()
    return cfg?.enabled === true
  }

  export async function maxRetries() {
    const cfg = await config()
    return cfg?.max_retries ?? 3
  }

  export function attempts(sessionID: string) {
    return retries[sessionID] ?? 0
  }

  export function increment(sessionID: string) {
    retries[sessionID] = (retries[sessionID] ?? 0) + 1
    log.info("retry increment", { sessionID, attempt: retries[sessionID] })
    return retries[sessionID]
  }

  export function reset(sessionID: string) {
    if (retries[sessionID]) {
      log.info("retry reset", { sessionID })
      delete retries[sessionID]
    }
  }

  /**
   * Scan the assistant message parts for tool results that contain
   * LSP diagnostic errors. Returns a list of files with errors.
   */
  export async function diagnosticErrors(messageID: string): Promise<string[]> {
    const parts = await MessageV2.parts(messageID)
    const files: string[] = []
    for (const part of parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      const meta = part.state.metadata as Record<string, any> | undefined
      if (!meta?.diagnostics) continue
      for (const [file, issues] of Object.entries(meta.diagnostics as Record<string, { severity: number }[]>)) {
        const errors = (issues ?? []).filter((i) => i.severity === 1)
        if (errors.length > 0 && !files.includes(file)) files.push(file)
      }
    }
    return files
  }

  /**
   * Check if we used any file-editing tools in this step.
   */
  export async function hadEdits(messageID: string): Promise<boolean> {
    const parts = await MessageV2.parts(messageID)
    const editTools = new Set(["edit", "write", "multiedit", "apply_patch"])
    return parts.some((p) => p.type === "tool" && editTools.has(p.tool))
  }

  /**
   * Determine if we should force a retry for diagnostic errors.
   * Returns the list of files with errors if retry should happen, empty array otherwise.
   */
  export async function check(input: {
    sessionID: string
    messageID: string
  }): Promise<{ retry: boolean; files: string[]; snapshot?: string }> {
    if (!(await enabled())) return { retry: false, files: [] }
    if (!(await hadEdits(input.messageID))) {
      reset(input.sessionID)
      return { retry: false, files: [] }
    }

    const files = await diagnosticErrors(input.messageID)
    if (files.length === 0) {
      reset(input.sessionID)
      return { retry: false, files: [] }
    }

    const max = await maxRetries()
    const current = attempts(input.sessionID)
    if (current >= max) {
      log.warn("max retries exhausted", { sessionID: input.sessionID, max, files })
      reset(input.sessionID)
      return { retry: false, files: [] }
    }

    log.info("diagnostic errors found, requesting retry", {
      sessionID: input.sessionID,
      attempt: current + 1,
      max,
      files,
    })
    return { retry: true, files }
  }
}

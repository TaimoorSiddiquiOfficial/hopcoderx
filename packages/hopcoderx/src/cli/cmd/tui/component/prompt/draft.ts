/**
 * Draft persistence — auto-saves typed text so nothing is lost on crash/exit.
 *
 * Drafts are stored as JSON files under `~/.hopcoderx/state/drafts/{sessionID}.json`.
 * Loaded on session open, deleted on successful submission, and flushed on exit.
 */
import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import type { PromptInfo } from "./history"

const log = Log.create({ service: "prompt/draft" })

export interface SessionDraft {
  sessionID: string
  input: string
  parts: PromptInfo["parts"]
  mode: "normal" | "shell"
  timestamp: number
}

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function draftsDir() {
  return path.join(Global.Path.state, "drafts")
}

function draftPath(sessionID: string) {
  return path.join(draftsDir(), `${sessionID}.json`)
}

export async function saveDraft(draft: SessionDraft): Promise<void> {
  try {
    await fs.mkdir(draftsDir(), { recursive: true })
    await fs.writeFile(draftPath(draft.sessionID), JSON.stringify(draft), "utf-8")
  } catch (e) {
    log.warn("failed to save draft", { sessionID: draft.sessionID, error: String(e) })
  }
}

export async function loadDraft(sessionID: string): Promise<SessionDraft | undefined> {
  try {
    const text = await Filesystem.readText(draftPath(sessionID))
    if (!text) return undefined
    const draft: SessionDraft = JSON.parse(text)
    if (Date.now() - draft.timestamp > DRAFT_MAX_AGE_MS) {
      await deleteDraft(sessionID)
      return undefined
    }
    return draft
  } catch {
    return undefined
  }
}

export async function deleteDraft(sessionID: string): Promise<void> {
  try {
    await fs.unlink(draftPath(sessionID))
  } catch {
    // ignore — file may not exist
  }
}

/** Remove drafts older than 7 days. Called once at startup. */
export async function cleanStaleDrafts(): Promise<void> {
  try {
    const dir = draftsDir()
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue
      const full = path.join(dir, entry)
      const stat = await fs.stat(full).catch(() => undefined)
      if (stat && now - stat.mtimeMs > DRAFT_MAX_AGE_MS) {
        await fs.unlink(full).catch(() => {})
      }
    }
  } catch {
    // best-effort cleanup
  }
}

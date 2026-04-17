/**
 * Git Context Injection — auto-detect branch/diff state and inject
 * relevant context into the system prompt so the LLM understands
 * what the user is working on without them manually pasting diffs.
 */

import { $ } from "bun"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "git-context" })

export namespace GitContext {
  const MAX_DIFF_CHARS = 4000 // Keep context small to avoid token bloat
  const CACHE_TTL_MS = 30_000 // Re-fetch at most every 30s

  let cachedContext: string | undefined
  let cachedAt = 0

  /** Build a compact git context string for injection into the system prompt. */
  export async function build(): Promise<string | undefined> {
    if (Date.now() - cachedAt < CACHE_TTL_MS && cachedContext !== undefined) {
      return cachedContext || undefined
    }

    try {
      const cwd = Instance.worktree
      const [branch, status, diffStat] = await Promise.all([
        $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(cwd).text().then(x => x.trim()).catch(() => ""),
        $`git status --porcelain`.quiet().nothrow().cwd(cwd).text().then(x => x.trim()).catch(() => ""),
        $`git diff --stat HEAD`.quiet().nothrow().cwd(cwd).text().then(x => x.trim()).catch(() => ""),
      ])

      if (!branch && !status) {
        cachedContext = ""
        cachedAt = Date.now()
        return undefined
      }

      const parts: string[] = []

      if (branch && branch !== "HEAD") {
        parts.push(`Branch: ${branch}`)
      }

      // Staged + unstaged file summary
      if (status) {
        const lines = status.split("\n").filter(Boolean)
        const staged = lines.filter(l => l[0] !== " " && l[0] !== "?").length
        const unstaged = lines.filter(l => l[1] !== " " && l[0] !== "?").length
        const untracked = lines.filter(l => l.startsWith("??")).length

        const statParts: string[] = []
        if (staged > 0) statParts.push(`${staged} staged`)
        if (unstaged > 0) statParts.push(`${unstaged} modified`)
        if (untracked > 0) statParts.push(`${untracked} untracked`)
        if (statParts.length > 0) {
          parts.push(`Working tree: ${statParts.join(", ")}`)
        }

        // List changed files (max 20)
        const changedFiles = lines
          .map(l => l.slice(3).trim())
          .filter(Boolean)
          .slice(0, 20)
        if (changedFiles.length > 0) {
          parts.push(`Changed files:\n${changedFiles.map(f => `  ${f}`).join("\n")}`)
        }
      }

      // Compact diff stat
      if (diffStat && diffStat.length <= MAX_DIFF_CHARS) {
        parts.push(`Diff summary:\n${diffStat}`)
      }

      const result = parts.length > 0 ? parts.join("\n") : ""
      cachedContext = result
      cachedAt = Date.now()

      if (result) {
        log.info("git context built", { branch, changedFiles: status.split("\n").length })
      }

      return result || undefined
    } catch (e) {
      log.warn("git context failed", { error: String(e) })
      cachedContext = ""
      cachedAt = Date.now()
      return undefined
    }
  }

  /** Invalidate the cache (e.g., after a git operation). */
  export function invalidate() {
    cachedAt = 0
    cachedContext = undefined
  }
}

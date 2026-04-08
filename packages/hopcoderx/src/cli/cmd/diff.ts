/**
 * Side-by-side TUI diff viewer.
 *
 * Commands:
 *   hopcoderx diff <file1> <file2>   — compare two files
 *   hopcoderx diff --git             — show current git diff (unstaged)
 *   hopcoderx diff --staged          — show staged git changes
 *   hopcoderx diff --commit <sha>    — show diff for a specific commit
 *   hopcoderx diff --pr <branch>     — show diff vs a branch
 *   hopcoderx diff --stat            — show summary only (no full diff)
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { readFile } from "fs/promises"
import path from "path"

// ─── Diff algorithm ───────────────────────────────────────────────────────────

interface DiffLine {
  type: "context" | "add" | "remove" | "header"
  lineA?: number
  lineB?: number
  text: string
}

function diffLines(a: string[], b: string[]): DiffLine[] {
  // Simple LCS-based diff
  const n = Math.min(a.length, 1000)
  const m = Math.min(b.length, 1000)

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Trace back
  const result: DiffLine[] = []
  let i = n
  let j = m
  let lineA = n
  let lineB = m
  const raw: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.unshift({ type: "context", lineA: i, lineB: j, text: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ type: "add", lineB: j, text: b[j - 1] })
      j--
    } else {
      raw.unshift({ type: "remove", lineA: i, text: a[i - 1] })
      i--
    }
  }

  // Add header and filter context (show only 3 lines around changes)
  const CONTEXT = 3
  const changed = new Set(raw.map((_, idx) => idx).filter((idx) => raw[idx].type !== "context"))
  const visible = new Set<number>()
  for (const idx of changed) {
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(raw.length - 1, idx + CONTEXT); k++) {
      visible.add(k)
    }
  }

  let lastVisible = -1
  for (let idx = 0; idx < raw.length; idx++) {
    if (!visible.has(idx)) continue
    if (lastVisible !== -1 && idx > lastVisible + 1) {
      result.push({ type: "header", text: `@@ ... @@` })
    }
    result.push(raw[idx])
    lastVisible = idx
  }

  return result
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const RESET = UI.Style.TEXT_NORMAL
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const DIM = UI.Style.TEXT_DIM
const BOLD = "\x1b[1m"

function renderDiff(lines: DiffLine[], fileA: string, fileB: string): void {
  const cols = process.stdout.columns ?? 100
  const halfCols = Math.floor((cols - 3) / 2)

  UI.println(`${BOLD}${CYAN}--- ${fileA}${RESET}`)
  UI.println(`${BOLD}${GREEN}+++ ${fileB}${RESET}`)
  UI.println("")

  for (const line of lines) {
    if (line.type === "header") {
      UI.println(`${CYAN}${DIM}${line.text}${RESET}`)
      continue
    }

    const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "
    const color = line.type === "add" ? GREEN : line.type === "remove" ? RED : DIM
    const lineNoA = line.lineA ? String(line.lineA).padStart(4) : "    "
    const lineNoB = line.lineB ? String(line.lineB).padStart(4) : "    "

    const text = line.text.slice(0, halfCols - 1)
    UI.println(`${DIM}${lineNoA} ${lineNoB}${RESET} ${color}${prefix} ${text}${RESET}`)
  }
}

function renderStat(lines: DiffLine[], fileA: string, fileB: string): void {
  const adds = lines.filter((l) => l.type === "add").length
  const removes = lines.filter((l) => l.type === "remove").length
  const bar = GREEN + "+".repeat(Math.min(adds, 40)) + RESET + RED + "-".repeat(Math.min(removes, 40)) + RESET
  UI.println(`  ${fileB.padEnd(50)} ${String(adds + removes).padStart(4)}  ${bar}`)
}

async function runGitDiff(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  if (exitCode !== 0) throw new Error(`git diff failed: ${await new Response(proc.stderr).text()}`)
  return stdout
}

function printGitDiff(raw: string, statOnly: boolean): void {
  if (!raw.trim()) {
    UI.println(UI.Style.TEXT_DIM + "  No changes." + RESET)
    return
  }

  const lines = raw.split("\n")
  let fileA = ""
  let fileB = ""
  let adds = 0
  let removes = 0
  const fileStats: Array<{ file: string; adds: number; removes: number }> = []

  if (statOnly) {
    // Parse git diff for stat summary
    for (const line of lines) {
      if (line.startsWith("diff --git")) {
        if (fileB) fileStats.push({ file: fileB.replace(/^b\//, ""), adds, removes })
        adds = 0
        removes = 0
        fileB = line.split(" ").pop() ?? ""
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        adds++
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        removes++
      }
    }
    if (fileB) fileStats.push({ file: fileB.replace(/^b\//, ""), adds, removes })

    UI.println("")
    let totalAdds = 0
    let totalRemoves = 0
    for (const s of fileStats) {
      const bar = GREEN + "+".repeat(Math.min(s.adds, 30)) + RESET + RED + "-".repeat(Math.min(s.removes, 30)) + RESET
      UI.println(`  ${s.file.padEnd(50)} ${String(s.adds + s.removes).padStart(5)}  ${bar}`)
      totalAdds += s.adds
      totalRemoves += s.removes
    }
    UI.println("")
    UI.println(
      `  ${fileStats.length} file${fileStats.length === 1 ? "" : "s"} changed, ` +
        `${GREEN}${totalAdds} insertion${totalAdds === 1 ? "" : "s"}(+)${RESET}, ` +
        `${RED}${totalRemoves} deletion${totalRemoves === 1 ? "" : "s"}(-)${RESET}`,
    )
    return
  }

  // Colorized full diff
  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("@@")) {
      UI.println(`${CYAN}${DIM}${line}${RESET}`)
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      UI.println(`${BOLD}${line}${RESET}`)
    } else if (line.startsWith("+")) {
      UI.println(`${GREEN}${line}${RESET}`)
    } else if (line.startsWith("-")) {
      UI.println(`${RED}${line}${RESET}`)
    } else {
      UI.println(`${DIM}${line}${RESET}`)
    }
  }
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export const DiffCommand = cmd({
  command: "diff [file1] [file2]",
  describe: "side-by-side diff viewer for files or git changes",
  builder: (yargs: Argv) =>
    yargs
      .positional("file1", { type: "string", describe: "First file (or omit with --git)" })
      .positional("file2", { type: "string", describe: "Second file (or omit with --git)" })
      .option("git", {
        type: "boolean",
        default: false,
        describe: "Show current unstaged git diff",
      })
      .option("staged", {
        type: "boolean",
        default: false,
        describe: "Show staged git changes",
      })
      .option("commit", {
        type: "string",
        describe: "Show diff for a specific commit SHA",
      })
      .option("pr", {
        type: "string",
        describe: "Show diff vs branch (e.g., main)",
      })
      .option("stat", {
        type: "boolean",
        default: false,
        describe: "Show summary statistics only",
      }),
  handler: async (args: {
    file1?: string
    file2?: string
    git?: boolean
    staged?: boolean
    commit?: string
    pr?: string
    stat?: boolean
  }) => {
    const cwd = Instance.directory ?? process.cwd()

    // Git modes
    if (args.git || args.staged || args.commit || args.pr) {
      try {
        let gitArgs = ["diff"]
        let title = "Git diff"
        if (args.staged) {
          gitArgs = ["diff", "--staged"]
          title = "Staged changes"
        } else if (args.commit) {
          gitArgs = ["diff", `${args.commit}^..${args.commit}`]
          title = `Commit ${args.commit.slice(0, 8)}`
        } else if (args.pr) {
          gitArgs = ["diff", args.pr]
          title = `Diff vs ${args.pr}`
        }

        if (args.stat) gitArgs.push("--stat")

        const raw = await runGitDiff(gitArgs, cwd)

        UI.println(UI.Style.TEXT_INFO_BOLD + `\n📄 ${title}` + RESET)
        printGitDiff(raw, args.stat ?? false)
      } catch (err) {
        UI.println(
          UI.Style.TEXT_DANGER_BOLD +
            `✗ ${err instanceof Error ? err.message : String(err)}` +
            RESET,
        )
      }
      return
    }

    // File diff mode
    if (!args.file1 || !args.file2) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
          "Usage: hopcoderx diff <file1> <file2>  OR  hopcoderx diff --git" +
          RESET,
      )
      return
    }

    const pathA = path.isAbsolute(args.file1) ? args.file1 : path.join(cwd, args.file1)
    const pathB = path.isAbsolute(args.file2) ? args.file2 : path.join(cwd, args.file2)

    try {
      const [contentA, contentB] = await Promise.all([
        readFile(pathA, "utf8"),
        readFile(pathB, "utf8"),
      ])

      const linesA = contentA.split("\n")
      const linesB = contentB.split("\n")

      UI.println(UI.Style.TEXT_INFO_BOLD + `\n📄 Diff: ${args.file1} → ${args.file2}` + RESET)
      UI.println("")

      if (args.stat) {
        const diffResult = diffLines(linesA, linesB)
        renderStat(diffResult, args.file1, args.file2)
      } else {
        const diffResult = diffLines(linesA, linesB)
        if (diffResult.length === 0) {
          UI.println(DIM + "  Files are identical." + RESET)
        } else {
          renderDiff(diffResult, args.file1, args.file2)
        }
      }
    } catch (err) {
      UI.println(
        UI.Style.TEXT_DANGER_BOLD +
          `✗ ${err instanceof Error ? err.message : String(err)}` +
          RESET,
      )
    }
  },
})

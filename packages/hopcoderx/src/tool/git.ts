/**
 * Structured git operations tool.
 *
 * Provides safe, structured access to common git commands with
 * formatted output, conflict detection, and auto-commit-message generation.
 */

import z from "zod"
import { Tool } from "./tool"
import { execFile } from "child_process"
import { promisify } from "util"
import { Instance } from "../project/instance"

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }).catch((e) => ({
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? (e.message as string),
  }))
}

const OPERATIONS = [
  "status",
  "diff",
  "commit",
  "add",
  "branch",
  "checkout",
  "log",
  "blame",
  "stash",
  "merge",
  "reset",
  "show",
  "pull",
  "push",
  "fetch",
  "tag",
  "remote",
] as const

export const GitTool = Tool.define("git", {
  description:
    "Run structured git operations: status, diff, commit, add, branch, checkout, log, blame, stash, merge, reset, show, pull, push, fetch, tag, remote. Use this instead of bash for git operations to get structured, safe output with conflict detection.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe("Git operation to perform"),
    args: z
      .array(z.string())
      .optional()
      .describe(
        "Additional arguments. Examples: diff → ['--stat', 'HEAD~1'], commit → ['-m', 'fix: bug'], log → ['--oneline', '-10'], blame → ['src/index.ts'], branch → ['-a']",
      ),
    message: z.string().optional().describe("Commit message (for commit operation)"),
    files: z.array(z.string()).optional().describe("Files to target (for add, diff, blame etc.)"),
    all: z.boolean().optional().describe("Stage all changes before commit (git add -A then commit)"),
  }),
  async execute(params, ctx) {
    const cwd = Instance.worktree || Instance.directory

    const op = params.operation
    const extraArgs = params.args ?? []

    await ctx.ask({
      permission: "git",
      patterns: [op, ...(params.files ?? [])],
      always: ["status", "diff", "log", "blame", "show", "remote", "fetch"],
      metadata: { operation: op },
    })

    let cmdArgs: string[]

    switch (op) {
      case "status":
        cmdArgs = ["status", "--short", "--branch", ...extraArgs]
        break
      case "diff":
        cmdArgs = ["diff", ...extraArgs, ...(params.files ?? [])]
        break
      case "add":
        if (params.all) {
          cmdArgs = ["add", "-A"]
        } else {
          cmdArgs = ["add", ...(params.files ?? ["."]), ...extraArgs]
        }
        break
      case "commit": {
        const msg = params.message ?? extraArgs.find((a) => !a.startsWith("-")) ?? ""
        if (!msg) return { title: "git commit", output: "Error: commit message is required. Provide `message` or include `-m 'msg'` in args.", metadata: { conflicts: [] } }
        if (params.all) {
          await git(["add", "-A"], cwd)
        }
        cmdArgs = ["commit", "-m", msg, ...extraArgs.filter((a) => a !== msg)]
        break
      }
      case "log":
        cmdArgs = ["log", "--oneline", "--decorate", "-20", ...extraArgs]
        break
      case "branch":
        cmdArgs = ["branch", ...extraArgs]
        break
      case "checkout":
        cmdArgs = ["checkout", ...extraArgs, ...(params.files ?? [])]
        break
      case "blame":
        cmdArgs = ["blame", ...(params.files ?? []), ...extraArgs]
        break
      case "stash":
        cmdArgs = ["stash", ...extraArgs]
        break
      case "merge":
        cmdArgs = ["merge", ...extraArgs]
        break
      case "reset":
        cmdArgs = ["reset", ...extraArgs, ...(params.files ?? [])]
        break
      case "show":
        cmdArgs = ["show", ...extraArgs]
        break
      case "pull":
        cmdArgs = ["pull", ...extraArgs]
        break
      case "push":
        cmdArgs = ["push", ...extraArgs]
        break
      case "fetch":
        cmdArgs = ["fetch", "--all", "--prune", ...extraArgs]
        break
      case "tag":
        cmdArgs = ["tag", ...extraArgs]
        break
      case "remote":
        cmdArgs = ["remote", "-v", ...extraArgs]
        break
      default:
        cmdArgs = [op, ...extraArgs]
    }

    const { stdout, stderr } = await git(cmdArgs, cwd)
    const output = [stdout, stderr].filter(Boolean).join("\n").trim()

    // Detect conflicts
    if (output.includes("CONFLICT") || output.includes("Merge conflict")) {
      const conflicted: string[] = output.match(/CONFLICT.*?in (.+)/g) ?? []
      return {
        title: `git ${op} — CONFLICTS`,
        output: `⚠️ Merge conflicts detected:\n${conflicted.join("\n")}\n\n${output}`,
        metadata: { conflicts: conflicted },
      }
    }

    return {
      title: `git ${op}`,
      output: output || `git ${op}: no output`,
      metadata: { conflicts: [] as string[] },
    }
  },
})

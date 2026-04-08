/**
 * `hopcoderx cron` — persistent scheduled tasks.
 *
 * Tasks are stored in a JSONL store (~/.local/share/hopcoderx/cron.jsonl).
 * The daemon heartbeat checks due tasks every minute and executes them.
 *
 * Sub-commands:
 *   cron add "<schedule>" "<command>"    Create a new scheduled task
 *   cron list                            List all tasks
 *   cron run <id>                        Run a task immediately
 *   cron delete <id>                     Delete a task
 *   cron enable <id>                     Enable a disabled task
 *   cron disable <id>                    Disable a task
 *   cron history [id]                    Show execution history
 *
 * Schedule formats (natural language + cron):
 *   "every 5 minutes", "daily at 2am", "every monday at 9am"
 *   "0 2 * * *" (standard cron syntax)
 */

import { join } from "path"
import { Global } from "../../global"
import { randomUUID } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

const execFileAsync = promisify(execFile)

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CronTask {
  id: string
  name: string
  schedule: string
  /** Parsed cron expression: [min, hour, dom, month, dow] */
  cron: string
  command: string
  enabled: boolean
  createdAt: number
  lastRun?: number
  lastResult?: "ok" | "error" | "timeout"
  lastOutput?: string
  runCount: number
  nextRun?: number
}

export interface CronHistory {
  taskId: string
  ts: number
  result: "ok" | "error" | "timeout"
  output: string
  durationMs: number
}

// ─── Storage helpers ───────────────────────────────────────────────────────────

function tasksPath() { return join(Global.Path.data, "cron.jsonl") }
function historyPath() { return join(Global.Path.data, "cron-history.jsonl") }

function readTasks(): CronTask[] {
  try {
    const fs = require("fs") as typeof import("fs")
    return fs.readFileSync(tasksPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}

function writeTasks(tasks: CronTask[]): void {
  const fs = require("fs") as typeof import("fs")
  require("fs").mkdirSync(Global.Path.data, { recursive: true })
  fs.writeFileSync(tasksPath(), tasks.map((t) => JSON.stringify(t)).join("\n") + (tasks.length ? "\n" : ""), "utf8")
}

function appendHistory(entry: CronHistory): void {
  const fs = require("fs") as typeof import("fs")
  fs.mkdirSync(Global.Path.data, { recursive: true })
  fs.appendFileSync(historyPath(), JSON.stringify(entry) + "\n", "utf8")
}

function readHistory(taskId?: string): CronHistory[] {
  try {
    const fs = require("fs") as typeof import("fs")
    const all = fs.readFileSync(historyPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CronHistory)
    return taskId ? all.filter((h) => h.taskId === taskId) : all
  } catch { return [] }
}

// ─── Schedule parser ───────────────────────────────────────────────────────────

const NATURAL_MAP: [RegExp, string | ((...args: any[]) => string)][] = [
  [/every\s+minute/i,                        "* * * * *"],
  [/every\s+(\d+)\s+minutes?/i,             "$1 * * * *"],
  [/every\s+hour/i,                          "0 * * * *"],
  [/every\s+(\d+)\s+hours?/i,              "0 */$1 * * *"],
  [/daily\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i, (_, h, m, ap) => {
    let hour = parseInt(h)
    if (ap?.toLowerCase() === "pm" && hour < 12) hour += 12
    if (ap?.toLowerCase() === "am" && hour === 12) hour = 0
    return `${m ?? "0"} ${hour} * * *`
  }],
  [/every\s+day\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)?/i, (_, h, m, ap) => {
    let hour = parseInt(h)
    if (ap?.toLowerCase() === "pm" && hour < 12) hour += 12
    return `${m ?? "0"} ${hour} * * *`
  }],
  [/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, (_, day) => {
    const days: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 }
    return `0 9 * * ${days[day.toLowerCase()]}`
  }],
  [/weekdays?\s+at\s+(\d+)/i, (_, h) => `0 ${h} * * 1-5`],
  [/midnight/i,  "0 0 * * *"],
  [/noon/i,      "0 12 * * *"],
]

function parseSchedule(input: string): string {
  // Already a cron expression (5 parts)
  if (/^\d[\d*,/-]* \d[\d*,/-]* \d[\d*,/-]* \d[\d*,/-]* \d[\d*,/-]*$/.test(input.trim())) {
    return input.trim()
  }
  for (const [re, replacement] of NATURAL_MAP) {
    const m = input.match(re)
    if (m) {
      return typeof replacement === "function"
        ? replacement(...m)
        : input.replace(re, replacement as string)
    }
  }
  return "0 9 * * *" // default: daily at 9am
}

/** Compute next run time from cron expression (simple implementation) */
function nextRunFromCron(cronExpr: string, from = Date.now()): number {
  try {
    // Use a simple heuristic: parse the cron and find next match
    const [min, hour, , , dow] = cronExpr.split(" ")
    const d = new Date(from + 60_000)
    for (let i = 0; i < 1440; i++) {
      const matches = (
        (min === "*"  || d.getMinutes() === parseInt(min)  || (min.startsWith("*/")  && d.getMinutes()  % parseInt(min.slice(2)) === 0)) &&
        (hour === "*" || d.getHours()   === parseInt(hour) || (hour.startsWith("*/") && d.getHours()    % parseInt(hour.slice(2)) === 0)) &&
        (dow === "*"  || d.getDay() === parseInt(dow))
      )
      if (matches) return d.getTime()
      d.setMinutes(d.getMinutes() + 1)
    }
  } catch {}
  return from + 86_400_000
}

// ─── Task executor (called by daemon) ─────────────────────────────────────────

export async function executeDueTasks(): Promise<void> {
  const tasks = readTasks()
  const now = Date.now()
  let changed = false

  for (const task of tasks) {
    if (!task.enabled) continue
    if (!task.nextRun || task.nextRun > now) continue

    const start = Date.now()
    let result: "ok" | "error" | "timeout" = "ok"
    let output = ""

    try {
      const { stdout, stderr } = await Promise.race([
        execFileAsync(process.platform === "win32" ? "cmd" : "sh", [
          process.platform === "win32" ? "/c" : "-c",
          task.command,
        ]),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 60_000)),
      ])
      output = (stdout + stderr).slice(0, 4096)
    } catch (e: any) {
      result = e?.message === "timeout" ? "timeout" : "error"
      output = String(e?.message ?? e)
    }

    const durationMs = Date.now() - start
    task.lastRun = now
    task.lastResult = result
    task.lastOutput = output.slice(0, 512)
    task.runCount = (task.runCount ?? 0) + 1
    task.nextRun = nextRunFromCron(task.cron)
    changed = true

    appendHistory({ taskId: task.id, ts: now, result, output, durationMs })
  }

  if (changed) writeTasks(tasks)
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

export const CronCommand = cmd({
  command: "cron [action]",
  describe: "Persistent scheduled tasks (natural language schedules)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["add", "list", "run", "delete", "enable", "disable", "history"] as const,
        default: "list",
      })
      .option("schedule", { alias: "s", type: "string", description: "Schedule (e.g. 'every 5 minutes', 'daily at 2am')" })
      .option("command",  { alias: "c", type: "string", description: "Shell command to run" })
      .option("name",     { alias: "n", type: "string", description: "Task name" })
      .option("id",       { type: "string", description: "Task ID" })
      .option("lines",    { type: "number", description: "History lines to show", default: 20 }),
  handler: async (args: {
    action?: string
    schedule?: string
    command?: string
    name?: string
    id?: string
    lines?: number
  }) => {
    switch (args.action ?? "list") {
      case "add": {
        if (!args.schedule) { console.error("Provide --schedule"); process.exit(1) }
        if (!args.command)  { console.error("Provide --command");  process.exit(1) }
        const cron = parseSchedule(args.schedule)
        const task: CronTask = {
          id: randomUUID().slice(0, 8),
          name: args.name ?? args.command.slice(0, 40),
          schedule: args.schedule,
          cron,
          command: args.command,
          enabled: true,
          createdAt: Date.now(),
          runCount: 0,
          nextRun: nextRunFromCron(cron),
        }
        const tasks = readTasks()
        tasks.push(task)
        writeTasks(tasks)
        console.log(`✅ Task created  id=${task.id}  cron="${cron}"  next=${new Date(task.nextRun!).toLocaleString()}`)
        break
      }

      case "list": {
        const tasks = readTasks()
        if (!tasks.length) { console.log("No scheduled tasks."); break }
        console.log("\n⏰ Scheduled tasks:\n")
        for (const t of tasks) {
          const st = t.enabled ? "🟢" : "⏸"
          const last = t.lastRun ? new Date(t.lastRun).toLocaleString() : "never"
          const next = t.nextRun ? new Date(t.nextRun).toLocaleString() : "—"
          console.log(`  ${st} ${t.id}  ${t.name}`)
          console.log(`       schedule: ${t.schedule} (${t.cron})`)
          console.log(`       command : ${t.command}`)
          console.log(`       last run: ${last}  next: ${next}  runs: ${t.runCount}`)
        }
        break
      }

      case "run": {
        if (!args.id) { console.error("Provide --id"); process.exit(1) }
        const tasks = readTasks()
        const task = tasks.find((t) => t.id === args.id)
        if (!task) { console.error(`Task ${args.id} not found`); process.exit(1) }
        console.log(`Running: ${task.command}`)
        // Force nextRun to past so executeDueTasks picks it up
        task.nextRun = 0
        writeTasks(tasks)
        await executeDueTasks()
        console.log("✅ Done.")
        break
      }

      case "delete": {
        if (!args.id) { console.error("Provide --id"); process.exit(1) }
        writeTasks(readTasks().filter((t) => t.id !== args.id))
        console.log(`🗑 Task ${args.id} deleted.`)
        break
      }

      case "enable":
      case "disable": {
        if (!args.id) { console.error("Provide --id"); process.exit(1) }
        const tasks = readTasks()
        const t = tasks.find((t) => t.id === args.id)
        if (!t) { console.error(`Task ${args.id} not found`); process.exit(1) }
        t.enabled = args.action === "enable"
        writeTasks(tasks)
        console.log(`${t.enabled ? "✅ Enabled" : "⏸ Disabled"} task ${args.id}`)
        break
      }

      case "history": {
        const history = readHistory(args.id).slice(-(args.lines ?? 20))
        if (!history.length) { console.log("No history."); break }
        for (const h of history) {
          const icon = h.result === "ok" ? "✅" : h.result === "timeout" ? "⏱" : "❌"
          console.log(`  ${icon} ${new Date(h.ts).toLocaleString()}  ${h.durationMs}ms  task=${h.taskId}`)
          if (h.output) console.log(`     ${h.output.slice(0, 120)}`)
        }
        break
      }

      default:
        console.error(`Unknown action: ${args.action}`)
        process.exit(1)
    }
  },
})

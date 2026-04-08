import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import path from "path"

export const ReplayCommand = cmd({
  command: "replay [session-id]",
  describe: "replay a past session step by step in the terminal",
  builder: (yargs: Argv) =>
    yargs
      .positional("session-id", {
        type: "string",
        describe: "Session ID to replay (omit for most recent)",
      })
      .option("speed", {
        type: "number",
        default: 1,
        describe: "Playback speed multiplier (0.5 = slow, 2 = fast, 0 = instant)",
      })
      .option("from", {
        type: "number",
        default: 0,
        describe: "Start from step N (0-indexed)",
      })
      .option("to", {
        type: "number",
        describe: "Stop at step N (inclusive)",
      })
      .option("tool-calls", {
        type: "boolean",
        default: true,
        describe: "Show tool call details",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output raw JSON events",
      }),
  handler: async (args: {
    "session-id"?: string
    speed?: number
    from?: number
    to?: number
    "tool-calls"?: boolean
    json?: boolean
  }) => {
    const speed = args.speed ?? 1
    const fromStep = args.from ?? 0
    const toStep = args.to
    const showTools = args["tool-calls"] ?? true
    const jsonOut = args.json ?? false

    // Find session files
    const sessionsDir = path.join(Global.Path.data, "sessions")
    const exists = await Filesystem.exists(sessionsDir)
    if (!exists) {
      console.error("No sessions found. Run hopcoderx first to create a session.")
      process.exit(1)
    }

    let sessionId = args["session-id"]
    if (!sessionId) {
    let files: string[]
    try {
      files = (require("fs")).readdirSync(sessionsDir).filter((f: string) => f.endsWith(".jsonl"))
    } catch {
      files = []
    }
    if (files.length === 0) {
      console.error("No sessions found.")
      process.exit(1)
    }
    // Sort by modification time (most recent first)
    sessionId = files.sort((a: string, b: string) => {
      try {
        const sa = (require("fs")).statSync(path.join(sessionsDir, a)).mtimeMs
        const sb = (require("fs")).statSync(path.join(sessionsDir, b)).mtimeMs
        return sb - sa
      } catch {
        return 0
      }
    })[0]?.replace?.(".jsonl", "") ?? ""
    }

    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`)
    const sessionExists = await Filesystem.exists(sessionFile)
    if (!sessionExists) {
      console.error(`Session "${sessionId}" not found at ${sessionFile}`)
      process.exit(1)
    }

    // Parse session events
    const content = await Filesystem.readText(sessionFile)
    const events = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    if (jsonOut) {
      console.log(JSON.stringify(events, null, 2))
      return
    }

    // Group into steps (user message + agent response)
    const steps: Array<Array<Record<string, any>>> = []
    let currentStep: Array<Record<string, any>> = []
    let stepIdx = 0

    for (const event of events) {
      const type = event.type ?? event.event ?? "unknown"
      if (type === "message" && event.role === "user" && currentStep.length > 0) {
        steps.push(currentStep)
        currentStep = []
        stepIdx++
      }
      currentStep.push(event)
    }
    if (currentStep.length > 0) steps.push(currentStep)

    const filteredSteps = steps.slice(fromStep, toStep !== undefined ? toStep + 1 : undefined)

    console.log(
      `\x1b[1m▶ Replaying session: ${sessionId}\x1b[0m  (${filteredSteps.length} of ${steps.length} steps, speed: ${speed}x)\n`,
    )

    const delay = (ms: number) => speed === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms / speed))

    for (let i = 0; i < filteredSteps.length; i++) {
      const step = filteredSteps[i]!
      console.log(`\x1b[2m── Step ${fromStep + i + 1}/${steps.length} ─────────────────────────\x1b[0m`)

      for (const event of step) {
        const ts = event.timestamp ? `\x1b[2m[${new Date(event.timestamp).toLocaleTimeString()}]\x1b[0m ` : ""
        const type = event.type ?? event.event ?? "unknown"

        if (type === "message") {
          const role = event.role ?? "unknown"
          const roleColor = role === "user" ? "\x1b[36m" : "\x1b[32m"
          const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content)
          console.log(`\n${ts}${roleColor}${role.toUpperCase()}\x1b[0m`)
          if (content) {
            // Print content with typewriter-like chunking
            const chunks = content.match(/.{1,80}/gs) ?? [content]
            for (const chunk of chunks) {
              process.stdout.write(chunk)
              if (speed > 0) await delay(50)
            }
            console.log()
          }
        } else if (type === "tool_call" || type === "tool-call") {
          if (!showTools) continue
          const toolName = event.tool ?? event.name ?? "unknown"
          console.log(`\n${ts}\x1b[33m⚙ TOOL: ${toolName}\x1b[0m`)
          if (event.args || event.arguments) {
            const argsStr = JSON.stringify(event.args ?? event.arguments, null, 2)
            console.log(`  \x1b[2m${argsStr.slice(0, 300)}${argsStr.length > 300 ? "..." : ""}\x1b[0m`)
          }
          if (event.result) {
            const resStr = typeof event.result === "string" ? event.result : JSON.stringify(event.result)
            console.log(`  \x1b[32m→\x1b[0m ${resStr.slice(0, 200)}${resStr.length > 200 ? "..." : ""}`)
          }
        } else if (type === "error") {
          console.log(`\n${ts}\x1b[31m✗ ERROR: ${event.message ?? event.error ?? JSON.stringify(event)}\x1b[0m`)
        }

        if (speed > 0) await delay(200)
      }

      if (i < filteredSteps.length - 1) {
        await delay(500)
      }
    }

    console.log(`\n\x1b[2m── End of replay ──────────────────────────\x1b[0m\n`)
  },
})

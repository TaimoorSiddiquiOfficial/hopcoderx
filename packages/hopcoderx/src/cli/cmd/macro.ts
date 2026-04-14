/**
 * hopcoderx macro — Record and playback command sequences
 *
 * Usage:
 *   hopcoderx macro start "my-macro"     Start recording
 *   hopcoderx macro stop                 Stop recording
 *   hopcoderx macro run "my-macro"       Execute recorded macro
 *   hopcoderx macro list                 List all macros
 *   hopcoderx macro show "my-macro"      Show macro contents
 *   hopcoderx macro delete "my-macro"    Delete a macro
 *   hopcoderx macro edit "my-macro"      Edit macro commands
 *
 * Features:
 *   - Record command sequences
 *   - Parameter interpolation {{param}}
 *   - Conditional execution
 *   - Share macros via git
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../../global"
import { execSync } from "child_process"
import type { Argv } from "yargs"

const MACROS_DIR = () => path.join(Global.Path.config, "macros")

interface Macro {
  name: string
  description: string
  commands: string[]
  parameters: string[]
  createdAt: number
  updatedAt: number
  runCount: number
}

async function getMacrosDir(): Promise<string> {
  const dir = MACROS_DIR()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function loadMacro(name: string): Promise<Macro | null> {
  try {
    const content = await fs.readFile(path.join(await getMacrosDir(), `${name}.json`), "utf8")
    return JSON.parse(content) as Macro
  } catch {
    return null
  }
}

async function saveMacro(macro: Macro): Promise<void> {
  const dir = await getMacrosDir()
  await fs.writeFile(path.join(dir, `${macro.name}.json`), JSON.stringify(macro, null, 2))
}

async function deleteMacro(name: string): Promise<void> {
  await fs.unlink(path.join(await getMacrosDir(), `${name}.json`))
}

async function listMacros(): Promise<Macro[]> {
  const dir = await getMacrosDir()
  const files = await fs.readdir(dir)
  const macros: Macro[] = []

  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const content = await fs.readFile(path.join(dir, file), "utf8")
    macros.push(JSON.parse(content) as Macro)
  }

  return macros.sort((a, b) => b.updatedAt - a.updatedAt)
}

// Recording state file
const RECORDING_STATE_FILE = () => path.join(Global.Path.data, "macro-recording.json")

interface RecordingState {
  isActive: boolean
  name: string
  commands: string[]
  startedAt: number
}

async function getRecordingState(): Promise<RecordingState> {
  try {
    const content = await fs.readFile(RECORDING_STATE_FILE(), "utf8")
    return JSON.parse(content) as RecordingState
  } catch {
    return { isActive: false, name: "", commands: [], startedAt: 0 }
  }
}

async function saveRecordingState(state: RecordingState): Promise<void> {
  await fs.mkdir(Global.Path.data, { recursive: true })
  await fs.writeFile(RECORDING_STATE_FILE(), JSON.stringify(state, null, 2))
}

async function clearRecordingState(): Promise<void> {
  await fs.unlink(RECORDING_STATE_FILE()).catch(() => {})
}

// Record a command if recording is active
export async function recordCommand(command: string): Promise<void> {
  const state = await getRecordingState()
  if (state.isActive) {
    state.commands.push(command)
    await saveRecordingState(state)
  }
}

export const MacroCommand = cmd({
  command: "macro <action>",
  describe: "Record and playback command sequences",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["start", "stop", "run", "list", "show", "delete", "edit", "export", "import"] as const,
        describe: "Action to perform",
      })
      .option("name", { alias: "n", type: "string", describe: "Macro name" })
      .option("description", { alias: "d", type: "string", describe: "Macro description" })
      .option("commands", { alias: "c", type: "array", describe: "Commands to record (for non-interactive create)" })
      .option("params", { type: "array", describe: "Parameter names for interpolation" })
      .option("dry-run", { type: "boolean", describe: "Preview without executing", default: false }),
  async handler(args) {
    const action = args.action as string

    // ─── START RECORDING ───────────────────────────────────────────────────
    if (action === "start") {
      UI.empty()
      prompts.intro("Start Macro Recording")

      const existing = await getRecordingState()
      if (existing.isActive) {
        prompts.log.warn(`Already recording macro: ${existing.name}`)
        prompts.log.info("Run 'hopcoderx macro stop' to finish recording")
        prompts.outro("Done")
        return
      }

      let name = args.name as string | undefined
      if (!name) {
        const nameResult = await prompts.text({
          message: "Macro name",
          placeholder: "my-macro",
          validate: (v) => (v && /^[a-z0-9-_]+$/.test(v) ? undefined : "Use lowercase letters, numbers, hyphens, underscores"),
        })
        if (prompts.isCancel(nameResult)) {
          prompts.outro("Cancelled")
          return
        }
        name = nameResult || undefined
      }

      const desc = args.description as string | undefined
      const description = desc ?? await prompts.text({
        message: "Description (optional)",
        placeholder: "What does this macro do?",
      })

      await saveRecordingState({
        isActive: true,
        name: name!,
        commands: [],
        startedAt: Date.now(),
      })

      prompts.log.success(`Recording started: ${name}`)
      prompts.log.info("Run hopcoderx commands normally. They will be recorded.")
      prompts.log.info("Run 'hopcoderx macro stop' when finished.")
      prompts.outro("Recording...")
      return
    }

    // ─── STOP RECORDING ────────────────────────────────────────────────────
    if (action === "stop") {
      UI.empty()
      prompts.intro("Stop Macro Recording")

      const state = await getRecordingState()
      if (!state.isActive) {
        prompts.log.warn("No recording in progress")
        prompts.log.info("Start with: hopcoderx macro start <name>")
        prompts.outro("Done")
        return
      }

      if (state.commands.length === 0) {
        prompts.log.warn("No commands recorded")
        prompts.log.info("Run some hopcoderx commands before stopping")
        await clearRecordingState()
        prompts.outro("Cancelled")
        return
      }

      const macro: Macro = {
        name: state.name,
        description: args.description as string || "",
        commands: state.commands,
        parameters: [],
        createdAt: state.startedAt,
        updatedAt: Date.now(),
        runCount: 0,
      }

      // Detect parameters in commands ({{param}} syntax)
      const paramPattern = /\{\{([^}]+)\}\}/g
      const params = new Set<string>()
      for (const cmd of state.commands) {
        let match
        while ((match = paramPattern.exec(cmd)) !== null) {
          params.add(match[1])
        }
      }
      macro.parameters = Array.from(params)

      await saveMacro(macro)
      await clearRecordingState()

      prompts.log.success(`Macro saved: ${macro.name}`)
      prompts.log.info(`Recorded ${macro.commands.length} command(s)`)
      if (macro.parameters.length > 0) {
        prompts.log.info(`Parameters: ${macro.parameters.join(", ")}`)
      }
      prompts.outro("Done")
      return
    }

    // ─── RUN MACRO ─────────────────────────────────────────────────────────
    if (action === "run") {
      UI.empty()
      prompts.intro("Run Macro")

      const name = args.name as string | undefined
      if (!name) {
        const macros = await listMacros()
        if (macros.length === 0) {
          prompts.log.warn("No macros found")
          prompts.log.info("Create one with: hopcoderx macro start <name>")
          prompts.outro("Done")
          return
        }

        const selected = await prompts.select({
          message: "Select macro to run",
          options: macros.map((m) => ({
            label: `${m.name} (${m.commands.length} commands)`,
            value: m.name,
            hint: m.description || `Created ${new Date(m.createdAt).toLocaleDateString()}`,
          })),
        })
        if (prompts.isCancel(selected)) {
          prompts.outro("Cancelled")
          return
        }
        return runMacro(selected)
      }

      return runMacro(name)
    }

    // ─── LIST MACROS ───────────────────────────────────────────────────────
    if (action === "list") {
      UI.empty()
      prompts.intro("Macros")

      const macros = await listMacros()
      if (macros.length === 0) {
        prompts.log.info("No macros found")
        prompts.log.info("Create one with: hopcoderx macro start <name>")
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Found ${macros.length} macro(s):\n`)
      for (const m of macros) {
        const params = m.parameters.length > 0 ? ` [${m.parameters.join(", ")}]` : ""
        prompts.log.info(`  ${UI.Style.TEXT_SUCCESS_BOLD}${m.name}${UI.Style.TEXT_NORMAL}${params}`)
        if (m.description) {
          prompts.log.info(`    ${UI.Style.TEXT_DIM}${m.description}${UI.Style.TEXT_NORMAL}`)
        }
        prompts.log.info(`    ${UI.Style.TEXT_DIM}${m.commands.length} commands · run ${m.runCount} times${UI.Style.TEXT_NORMAL}`)
      }

      prompts.outro("Done")
      return
    }

    // ─── SHOW MACRO ────────────────────────────────────────────────────────
    if (action === "show") {
      UI.empty()
      prompts.intro("Show Macro")

      const name = args.name as string | undefined
      if (!name) {
        prompts.log.error("--name required")
        prompts.outro("Failed")
        process.exit(1)
      }

      const macro = await loadMacro(name)
      if (!macro) {
        prompts.log.error(`Macro not found: ${name}`)
        prompts.outro("Failed")
        process.exit(1)
      }

      prompts.log.info(`Macro: ${macro.name}`)
      if (macro.description) {
        prompts.log.info(`Description: ${macro.description}`)
      }
      if (macro.parameters.length > 0) {
        prompts.log.info(`Parameters: ${macro.parameters.join(", ")}`)
      }
      prompts.log.info(`\nCommands (${macro.commands.length}):\n`)
      for (const cmd of macro.commands) {
        prompts.log.info(`  $ ${cmd}`)
      }

      prompts.outro("Done")
      return
    }

    // ─── DELETE MACRO ──────────────────────────────────────────────────────
    if (action === "delete") {
      UI.empty()
      prompts.intro("Delete Macro")

      const name = args.name as string | undefined
      if (!name) {
        prompts.log.error("--name required")
        prompts.outro("Failed")
        process.exit(1)
      }

      const macro = await loadMacro(name)
      if (!macro) {
        prompts.log.error(`Macro not found: ${name}`)
        prompts.outro("Failed")
        process.exit(1)
      }

      const confirm = await prompts.confirm({
        message: `Delete macro "${name}"?`,
      })

      if (prompts.isCancel(confirm) || !confirm) {
        prompts.outro("Cancelled")
        return
      }

      await deleteMacro(name)
      prompts.log.success(`Macro deleted: ${name}`)
      prompts.outro("Done")
      return
    }

    // ─── EDIT MACRO ────────────────────────────────────────────────────────
    if (action === "edit") {
      UI.empty()
      prompts.intro("Edit Macro")

      const name = args.name as string | undefined
      if (!name) {
        prompts.log.error("--name required")
        prompts.outro("Failed")
        process.exit(1)
      }

      const macro = await loadMacro(name)
      if (!macro) {
        prompts.log.error(`Macro not found: ${name}`)
        prompts.outro("Failed")
        process.exit(1)
      }

      prompts.log.info(`Editing: ${macro.name}`)
      prompts.log.info("Use hopcoderx macro delete and create to modify macros")
      prompts.log.info("Or edit the JSON file directly:")
      prompts.log.info(`  ${path.join(await getMacrosDir(), `${name}.json`)}`)
      prompts.outro("Done")
      return
    }

    // ─── EXPORT MACRO ──────────────────────────────────────────────────────
    if (action === "export") {
      const name = args.name as string | undefined
      if (!name) {
        prompts.log.error("--name required")
        process.exit(1)
      }

      const macro = await loadMacro(name)
      if (!macro) {
        prompts.log.error(`Macro not found: ${name}`)
        process.exit(1)
      }

      process.stdout.write(JSON.stringify(macro, null, 2))
      return
    }

    // ─── IMPORT MACRO ──────────────────────────────────────────────────────
    if (action === "import") {
      UI.empty()
      prompts.intro("Import Macro")

      // Read from stdin
      let content = ""
      for await (const chunk of process.stdin) {
        content += chunk
      }

      try {
        const macro = JSON.parse(content) as Macro
        if (!macro.name || !macro.commands) {
          throw new Error("Invalid macro format")
        }
        macro.updatedAt = Date.now()
        await saveMacro(macro)
        prompts.log.success(`Macro imported: ${macro.name}`)
        prompts.outro("Done")
      } catch (e) {
        prompts.log.error("Invalid macro JSON")
        prompts.outro("Failed")
        process.exit(1)
      }
      return
    }

    prompts.log.error(`Unknown action: ${action}`)
    prompts.outro("Failed")
  },
})

async function runMacro(name: string): Promise<void> {
  const macro = await loadMacro(name)
  if (!macro) {
    UI.println(UI.Style.TEXT_DANGER + `Macro not found: ${name}` + UI.Style.TEXT_NORMAL)
    process.exit(1)
  }

  const args: Record<string, string> = {}

  // Collect parameter values if needed
  if (macro.parameters.length > 0) {
    UI.println(UI.Style.TEXT_INFO + `Macro requires ${macro.parameters.length} parameter(s):` + UI.Style.TEXT_NORMAL)
    for (const param of macro.parameters) {
      const value = await prompts.text({
        message: param,
        placeholder: `Enter ${param}`,
      })
      if (prompts.isCancel(value)) {
        prompts.outro("Cancelled")
        return
      }
      args[param] = value
    }
  }

  const spinner = prompts.spinner()
  spinner.start(`Running macro: ${name}`)

  let successCount = 0
  let errorCount = 0

  for (const cmd of macro.commands) {
    // Interpolate parameters
    let interpolated = cmd
    for (const [key, value] of Object.entries(args)) {
      interpolated = interpolated.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
    }

    try {
      const output = execSync(interpolated, { encoding: "utf8", stdio: "pipe" })
      successCount++
      if (output.trim()) {
        UI.println(output.trim())
      }
    } catch (e: any) {
      errorCount++
      UI.println(UI.Style.TEXT_DANGER + `Error: ${e.message}` + UI.Style.TEXT_NORMAL)
    }
  }

  spinner.stop()

  // Update run count
  macro.runCount++
  macro.updatedAt = Date.now()
  await saveMacro(macro)

  if (errorCount > 0) {
    prompts.log.warn(`Macro completed with ${errorCount} error(s)`)
  } else {
    prompts.log.success(`Macro completed: ${successCount} command(s) executed`)
  }
  prompts.outro("Done")
}

/**
 * hopcoderx taskflow — manage multi-step task flows
 *
 * Usage:
 *   hopcoderx taskflow list                    List all flows
 *   hopcoderx taskflow list --status running   Filter by status
 *   hopcoderx taskflow status <id>             Show flow details
 *   hopcoderx taskflow run <id>                Execute pending steps
 *   hopcoderx taskflow delete <id>             Delete a flow
 *   hopcoderx taskflow create --name <n> --steps <json>   Create a flow
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { TaskFlowRegistry, type TaskStep } from "../../task/taskflow"
import { execSync } from "child_process"

const STATUS_ICON: Record<string, string> = {
  pending: "⏳",
  running: "🔄",
  done: "✅",
  failed: "❌",
  cancelled: "🚫",
  skipped: "⏭️",
}

export const TaskflowCommand = cmd({
  command: "taskflow <action>",
  describe: "Manage multi-step task flows that survive agent restarts",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", { choices: ["list", "status", "run", "delete", "create"] as const })
      .option("id", { type: "string", describe: "Flow ID" })
      .option("status", { type: "string", describe: "Filter by status (list)" })
      .option("name", { type: "string", describe: "Flow name (create)" })
      .option("description", { alias: "desc", type: "string", default: "", describe: "Description (create)" })
      .option("steps", { type: "string", describe: "JSON array of steps (create)" })
      .option("tags", { type: "string", describe: "Comma-separated tags (create)" }),

  async handler(args) {
    const action = (args.action as string) ?? "list"

    if (action === "list") {
      const status = args.status as string | undefined
      const flows = await TaskFlowRegistry.list(status as any)
      if (flows.length === 0) {
        console.log("No task flows found.")
        return
      }
      console.log(`Task flows (${flows.length}):`)
      for (const f of flows) {
        const done = f.steps.filter((s) => s.status === "done").length
        console.log(`  ${STATUS_ICON[f.status]} ${f.id.padEnd(28)} ${f.name.padEnd(30)} [${done}/${f.steps.length} steps]`)
      }
      return
    }

    if (action === "status") {
      const id = args.id as string | undefined
      if (!id) { console.error("--id required"); process.exit(1) }
      const flow = await TaskFlowRegistry.get(id)
      if (!flow) { console.error(`Flow not found: ${id}`); process.exit(1) }
      console.log(`Flow: ${flow.name} (${flow.id})`)
      console.log(`Status: ${STATUS_ICON[flow.status]} ${flow.status}`)
      if (flow.description) console.log(`Description: ${flow.description}`)
      console.log(`Steps (${flow.steps.length}):`)
      for (const step of flow.steps) {
        const dep = step.dependsOn.length ? ` [deps: ${step.dependsOn.join(",")}]` : ""
        console.log(`  ${STATUS_ICON[step.status]} ${step.id.padEnd(20)} ${step.name}${dep}`)
        if (step.error) console.log(`    Error: ${step.error}`)
        if (step.output) console.log(`    Output: ${step.output.slice(0, 100)}`)
      }
      return
    }

    if (action === "run") {
      const id = args.id as string | undefined
      if (!id) { console.error("--id required"); process.exit(1) }
      const flow = await TaskFlowRegistry.get(id)
      if (!flow) { console.error(`Flow not found: ${id}`); process.exit(1) }
      console.log(`Running flow: ${flow.name} …`)
      await TaskFlowRegistry.executeReady(id, async (step: TaskStep) => {
        console.log(`  ▶ ${step.name}: ${step.command}`)
        try {
          const out = execSync(step.command, { encoding: "utf8", timeout: step.timeoutMs || 60000 })
          console.log(`  ✅ done`)
          return out.slice(0, 2000)
        } catch (e: any) {
          throw new Error(e.stderr?.toString() || e.message)
        }
      })
      const updated = await TaskFlowRegistry.get(id)
      console.log(`\nFlow ${updated?.status === "done" ? "✅ completed" : `❌ ended with status: ${updated?.status}`}`)
      return
    }

    if (action === "delete") {
      const id = args.id as string | undefined
      if (!id) { console.error("--id required"); process.exit(1) }
      await TaskFlowRegistry.delete(id)
      console.log(`Deleted flow: ${id}`)
      return
    }

    if (action === "create") {
      const name = args.name as string | undefined
      const stepsJson = args.steps as string | undefined
      if (!name || !stepsJson) { console.error("--name and --steps required"); process.exit(1) }
      let steps: TaskStep[]
      try {
        steps = JSON.parse(stepsJson)
      } catch {
        console.error("--steps must be valid JSON array")
        process.exit(1)
      }
      const tags = ((args.tags as string) ?? "").split(",").map((t) => t.trim()).filter(Boolean)
      const flow = await TaskFlowRegistry.create({
        name,
        description: (args.description as string) ?? "",
        steps: steps.map((s, i) => ({
          id: s.id ?? `step_${i + 1}`,
          name: s.name ?? s.command,
          command: s.command,
          dependsOn: s.dependsOn ?? [],
          maxAttempts: s.maxAttempts ?? 1,
          timeoutMs: s.timeoutMs ?? 60000,
          status: "pending",
          attempts: 0,
        })),
        tags,
      })
      console.log(`✅ Created flow: ${flow.id}`)
      console.log(`Run it with: hopcoderx taskflow run --id ${flow.id}`)
      return
    }

    console.error(`Unknown action: ${action}`)
    process.exit(1)
  },
})

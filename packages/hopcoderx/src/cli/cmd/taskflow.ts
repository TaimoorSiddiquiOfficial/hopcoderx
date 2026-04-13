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
import { TaskFlowRegistry, type TaskStep, type FlowStatus } from "../../task/taskflow"
import { execSync } from "child_process"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"

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
      .option("tags", { type: "string", describe: "Comma-separated tags (create)" })
      .option("dry-run", { type: "boolean", describe: "Preview changes without applying", default: false }),

  async handler(args) {
    const action = (args.action as string) ?? "list"

    if (action === "list") {
      UI.empty()
      prompts.intro("Task Flows")
      const statusArg = args.status as string | undefined
      const validStatuses = ["pending", "running", "done", "failed", "cancelled"]
      const status = statusArg && validStatuses.includes(statusArg) ? statusArg as FlowStatus : undefined
      const flows = await TaskFlowRegistry.list(status)
      if (flows.length === 0) {
        prompts.log.info("No task flows found")
        prompts.log.info("Create one with: hopcoderx taskflow create --name <name> --steps '<json>'")
        prompts.outro("Done")
        return
      }
      prompts.log.info(`Found ${flows.length} task flow(s):\n`)
      for (const f of flows) {
        const done = f.steps.filter((s) => s.status === "done").length
        prompts.log.info(`  ${STATUS_ICON[f.status]} ${f.name}\n    ${UI.Style.TEXT_DIM}ID: ${f.id} | ${done}/${f.steps.length} steps${UI.Style.TEXT_NORMAL}`)
      }
      prompts.outro(`${flows.length} flow(s)`)
      return
    }

    if (action === "status") {
      UI.empty()
      prompts.intro("Task Flow Status")
      const id = args.id as string | undefined
      if (!id) {
        prompts.log.error("--id required")
        prompts.outro("Failed")
        process.exit(1)
      }
      const flow = await TaskFlowRegistry.get(id)
      if (!flow) {
        prompts.log.error(`Flow not found: ${id}`)
        prompts.outro("Failed")
        process.exit(1)
      }
      prompts.log.info(`Flow: ${flow.name} ${UI.Style.TEXT_DIM}(${flow.id})${UI.Style.TEXT_NORMAL}`)
      prompts.log.info(`Status: ${STATUS_ICON[flow.status]} ${flow.status}`)
      if (flow.description) prompts.log.info(`Description: ${flow.description}`)
      prompts.log.info(`\nSteps (${flow.steps.length}):\n`)
      for (const step of flow.steps) {
        const dep = step.dependsOn.length ? ` ${UI.Style.TEXT_DIM}[deps: ${step.dependsOn.join(",")}]${UI.Style.TEXT_NORMAL}` : ""
        prompts.log.info(`  ${STATUS_ICON[step.status]} ${step.name}${dep}`)
        if (step.error) prompts.log.error(`    Error: ${step.error}`)
        if (step.output) prompts.log.info(`    Output: ${step.output.slice(0, 100)}${step.output.length > 100 ? "..." : ""}`)
      }
      prompts.outro("Done")
      return
    }

    if (action === "run") {
      UI.empty()
      prompts.intro("Run Task Flow")
      const id = args.id as string | undefined
      if (!id) {
        prompts.log.error("--id required")
        prompts.outro("Failed")
        process.exit(1)
      }
      const flow = await TaskFlowRegistry.get(id)
      if (!flow) {
        prompts.log.error(`Flow not found: ${id}`)
        prompts.outro("Failed")
        process.exit(1)
      }
      prompts.log.info(`Running flow: ${flow.name}…`)
      const spinner = prompts.spinner()
      spinner.start("Executing steps")
      try {
        await TaskFlowRegistry.executeReady(id, async (step: TaskStep) => {
          spinner.message(`${step.name}`)
          try {
            const out = execSync(step.command, { encoding: "utf8", timeout: step.timeoutMs || 60000 })
            return out.slice(0, 2000)
          } catch (e: any) {
            throw new Error(e.stderr?.toString() || e.message)
          }
        })
        const updated = await TaskFlowRegistry.get(id)
        spinner.stop()
        if (updated?.status === "done") {
          prompts.log.success("Flow completed successfully")
        } else {
          prompts.log.warn(`Flow ended with status: ${updated?.status}`)
        }
      } catch (error) {
        spinner.stop()
        prompts.log.error(error instanceof Error ? error.message : String(error))
        prompts.outro("Failed")
        return
      }
      prompts.outro("Done")
      return
    }

    if (action === "delete") {
      UI.empty()
      prompts.intro("Delete Task Flow")
      const id = args.id as string | undefined
      if (!id) {
        prompts.log.error("--id required")
        prompts.outro("Failed")
        process.exit(1)
      }
      if (args.dryRun) {
        prompts.log.info(`[dry-run] Would delete flow: ${id}`)
        prompts.outro("Dry run complete")
        return
      }
      await TaskFlowRegistry.delete(id)
      prompts.log.success(`Deleted flow: ${id}`)
      prompts.outro("Done")
      return
    }

    if (action === "create") {
      UI.empty()
      prompts.intro("Create Task Flow")
      const name = args.name as string | undefined
      const stepsJson = args.steps as string | undefined
      if (!name || !stepsJson) {
        prompts.log.error("--name and --steps required")
        prompts.outro("Failed")
        process.exit(1)
      }
      let steps: TaskStep[]
      try {
        steps = JSON.parse(stepsJson)
      } catch {
        prompts.log.error("--steps must be valid JSON array")
        prompts.outro("Failed")
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
      prompts.log.success(`Created flow: ${flow.id}`)
      prompts.log.info(`Run it with: hopcoderx taskflow run --id ${flow.id}`)
      prompts.outro("Done")
      return
    }

    prompts.log.error(`Unknown action: ${action}`)
    prompts.outro("Failed")
    process.exit(1)
  },
})

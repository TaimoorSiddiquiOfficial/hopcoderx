/**
 * Compose tool — sequential tool pipelines with data flow.
 *
 * Execute a named pipeline of tool calls where each step's output
 * can be passed as input to the next step, with optional conditionals.
 * Useful for automating multi-step workflows within a single tool call.
 */

import z from "zod"
import { Tool } from "./tool"

const StepSchema = z.object({
  tool: z.string().describe("Tool ID to call (e.g. 'bash', 'websearch', 'git', 'http')"),
  args: z.record(z.string(), z.unknown()).describe("Arguments for the tool"),
  output_as: z.string().optional().describe("Store this step's output under this variable name for use in later steps via {{variable_name}}"),
  skip_if_empty: z.boolean().optional().describe("Skip this step if the previous step produced empty output"),
  condition: z.string().optional().describe("Only run this step if this string appears in the previous step output"),
})

export const ComposeTool = Tool.define("compose", {
  description:
    "Run a sequential pipeline of tool calls. Each step's output is passed to the next. Use `output_as` to name a step's output and reference it in later steps with {{variable_name}}. Use `condition` to skip a step unless previous output contains a string. Ideal for automating multi-step workflows like: search → summarize → create file.",
  parameters: z.object({
    name: z.string().optional().describe("Pipeline name for display (optional)"),
    steps: z.array(StepSchema).min(1).max(20).describe("Ordered list of tool steps to execute"),
    stop_on_error: z.boolean().optional().default(true).describe("Stop pipeline if any step fails (default true)"),
  }),
  async execute(params, ctx) {
    const variables: Record<string, string> = {}
    const results: Array<{ step: number; tool: string; output: string; skipped?: boolean; error?: string }> = []

    function interpolate(obj: unknown): unknown {
      if (typeof obj === "string") {
        return obj.replace(/\{\{(\w+)\}\}/g, (_, name) => variables[name] ?? `{{${name}}}`)
      }
      if (Array.isArray(obj)) return obj.map(interpolate)
      if (obj && typeof obj === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          out[k] = interpolate(v)
        }
        return out
      }
      return obj
    }

    let lastOutput = ""
    const pipelineName = params.name ?? "compose"

    for (let i = 0; i < params.steps.length; i++) {
      const step = params.steps[i]!
      const stepNum = i + 1

      // Check skip conditions
      if (step.skip_if_empty && !lastOutput.trim()) {
        results.push({ step: stepNum, tool: step.tool, output: "(skipped — empty input)", skipped: true })
        continue
      }
      if (step.condition && !lastOutput.includes(step.condition)) {
        results.push({ step: stepNum, tool: step.tool, output: `(skipped — condition '${step.condition}' not met)`, skipped: true })
        continue
      }

      // Interpolate variables into args
      const interpolatedArgs = interpolate(step.args) as Record<string, unknown>

      // Inject previous output as _prev variable
      variables["_prev"] = lastOutput

      // Dynamically call the tool
      try {
        const { ToolRegistry } = await import("./registry")
        const ctxModel = ctx.extra?.model as { id?: string; providerID?: string } | undefined
        const tools = await ToolRegistry.tools({
          modelID: ctxModel?.id ?? "",
          providerID: ctxModel?.providerID ?? "",
        })
        const toolDef = tools.find((t) => t.id === step.tool)
        if (!toolDef) {
          const err = `Tool '${step.tool}' not found. Available: ${tools.map((t) => t.id).slice(0, 20).join(", ")}`
          if (params.stop_on_error) {
            results.push({ step: stepNum, tool: step.tool, output: err, error: err })
            break
          }
          results.push({ step: stepNum, tool: step.tool, output: err, error: err })
          continue
        }

        const result = await toolDef.execute(interpolatedArgs, ctx)
        lastOutput = result.output ?? ""

        if (step.output_as) {
          variables[step.output_as] = lastOutput
        }

        results.push({ step: stepNum, tool: step.tool, output: lastOutput })
      } catch (e: any) {
        const errMsg = e instanceof Error ? e.message : String(e)
        results.push({ step: stepNum, tool: step.tool, output: errMsg, error: errMsg })
        lastOutput = ""
        if (params.stop_on_error) break
      }
    }

    const completed = results.filter((r) => !r.skipped && !r.error).length
    const skipped = results.filter((r) => r.skipped).length
    const errors = results.filter((r) => r.error).length

    const summary: string[] = [
      `Pipeline: ${pipelineName} (${completed} completed, ${skipped} skipped, ${errors} errors)`,
      "",
    ]
    for (const r of results) {
      const icon = r.error ? "❌" : r.skipped ? "⏭" : "✅"
      const preview = r.output.slice(0, 200).replace(/\n/g, "↵")
      summary.push(`${icon} Step ${r.step} [${r.tool}]: ${preview}${r.output.length > 200 ? "…" : ""}`)
    }

    return {
      title: `compose — ${pipelineName}`,
      output: summary.join("\n"),
      metadata: { steps: params.steps.length, completed, skipped, errors, lastOutput: lastOutput.slice(0, 500) },
    }
  },
})

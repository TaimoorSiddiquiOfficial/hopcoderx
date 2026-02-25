import { Log } from "@/util/log"
import { AgentContext } from "./context"
import { Orchestrator } from "./orchestrator"
import { Agent } from "./agent"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"

export namespace Swarm {
  const log = Log.create({ service: "agent.swarm" })

  export type ReviewVerdict = {
    approved: boolean
    issues: string[]
    summary: string
  }

  export type StepResult = {
    step: AgentContext.Step
    output: string
    review?: ReviewVerdict
    retries: number
  }

  export type SwarmResult = {
    jobID: string
    task: string
    steps: StepResult[]
    status: "done" | "failed" | "partial"
    summary: string
  }

  // Topological sort: returns steps in execution order respecting depends_on
  export function schedule(steps: AgentContext.Step[]): AgentContext.Step[][] {
    const done = new Set<string>()
    const remaining = [...steps]
    const waves: AgentContext.Step[][] = []

    while (remaining.length > 0) {
      const ready = remaining.filter((s) => s.depends_on.every((d) => done.has(d)))
      if (ready.length === 0) {
        log.warn("swarm: circular dependency detected, forcing remaining steps", {
          remaining: remaining.map((s) => s.id),
        })
        waves.push(remaining.splice(0))
        break
      }
      waves.push(ready)
      for (const s of ready) {
        done.add(s.id)
        remaining.splice(remaining.indexOf(s), 1)
      }
    }

    return waves
  }

  // Parse reviewer output into structured verdict
  export function parseReview(raw: string): ReviewVerdict {
    const verdict = /VERDICT:\s*(approve|revise)/i.exec(raw)
    const approved = verdict ? verdict[1].toLowerCase() === "approve" : !raw.toLowerCase().includes("revise")

    const issues: string[] = []
    const lines = raw.split("\n")
    let inIssues = false
    for (const line of lines) {
      if (/^ISSUES:/i.test(line)) {
        inIssues = true
        continue
      }
      if (/^SUMMARY:/i.test(line)) break
      if (inIssues && line.trim().startsWith("-")) {
        issues.push(line.trim().replace(/^-\s*/, ""))
      }
    }

    const summaryMatch = /SUMMARY:\s*(.+)/is.exec(raw)
    const summary = summaryMatch ? summaryMatch[1].trim().split("\n")[0] : ""

    return { approved, issues, summary }
  }

  // Run a single step as a subagent session
  async function runStep(input: {
    step: AgentContext.Step
    parentSessionID: string
    context: Record<string, string>
    previousOutputs: Record<string, string>
  }): Promise<string> {
    const agent = await Agent.get(input.step.agent || "build")
    if (!agent) throw new Error(`Unknown agent: ${input.step.agent}`)

    const session = await Session.create({
      parentID: input.parentSessionID,
      title: `Swarm: ${input.step.task} (@${agent.name})`,
      permission: [],
    })

    const refs = input.step.refs
      .filter((r) => input.context[r])
      .map((r) => `File ${r}:\n${input.context[r]}`)
      .join("\n\n")

    const deps = input.step.depends_on
      .filter((d) => input.previousOutputs[d])
      .map((d) => `Output from ${d}:\n${input.previousOutputs[d]}`)
      .join("\n\n")

    const prompt = [
      `Task: ${input.step.task}`,
      refs ? `\nReferences:\n${refs}` : "",
      deps ? `\nPrevious step outputs:\n${deps}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const model = agent.model ?? (await Provider.defaultModel())

    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      agent: agent.name,
      tools: {},
      parts: [{ type: "text", text: prompt }],
    })

    return result.parts.findLast((x) => x.type === "text")?.text ?? ""
  }

  // Run the reviewer agent on a step's output
  async function review(input: {
    step: AgentContext.Step
    output: string
    parentSessionID: string
  }): Promise<ReviewVerdict> {
    const agent = await Agent.get("reviewer")
    if (!agent) return { approved: true, issues: [], summary: "No reviewer agent configured" }

    const session = await Session.create({
      parentID: input.parentSessionID,
      title: `Review: ${input.step.task}`,
      permission: [],
    })

    const prompt = [
      `Review the following code changes for this task:`,
      `Task: ${input.step.task}`,
      "",
      "<code-output>",
      input.output,
      "</code-output>",
      "",
      "Evaluate correctness, safety, style, completeness, and types. Return your VERDICT, ISSUES, and SUMMARY.",
    ].join("\n")

    const model = agent.model ?? (await Provider.defaultModel())

    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: session.id,
      model: {
        modelID: model.modelID,
        providerID: model.providerID,
      },
      agent: "reviewer",
      tools: {},
      parts: [{ type: "text", text: prompt }],
    })

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    return parseReview(text)
  }

  // Execute the full swarm pipeline: decompose → schedule → execute → review
  export async function execute(input: {
    task: string
    sessionID: string
    context?: Record<string, string>
    maxReviewRetries?: number
  }): Promise<SwarmResult> {
    const config = await Config.get()
    const swarmConfig = config.experimental?.swarm
    const maxRetries = input.maxReviewRetries ?? swarmConfig?.max_review_retries ?? 2
    const reviewEnabled = swarmConfig?.review !== false
    const jobID = Orchestrator.jobId()

    log.info("swarm: starting", { jobID, task: input.task })

    // Phase 1: Decompose task into steps
    const decompose = Orchestrator.decomposePrompt(input.task, input.context ?? {})
    const planner = await Agent.get("plan") ?? await Agent.get("build")
    if (!planner) throw new Error("No planner agent available")

    const planSession = await Session.create({
      parentID: input.sessionID,
      title: `Swarm Plan: ${input.task}`,
      permission: [],
    })

    const planModel = planner.model ?? (await Provider.defaultModel())
    const planResult = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: planSession.id,
      model: {
        modelID: planModel.modelID,
        providerID: planModel.providerID,
      },
      agent: planner.name,
      system: Orchestrator.DECOMPOSE_SYSTEM,
      tools: {},
      parts: [{ type: "text", text: decompose }],
    })

    const planText = planResult.parts.findLast((x) => x.type === "text")?.text ?? "{}"
    let parsed: Orchestrator.DecomposeResult
    try {
      parsed = Orchestrator.parseJson(planText)
    } catch {
      log.error("swarm: failed to parse decomposition", { planText })
      return {
        jobID,
        task: input.task,
        steps: [],
        status: "failed",
        summary: "Failed to decompose task into steps",
      }
    }

    // Get tier from config (default free)
    const tier = (config.experimental?.swarm?.tier as AgentContext.Info["tier"]) ?? "free"
    const steps = Orchestrator.assignModels(parsed.steps, tier)

    // Check for gaps
    const gaps = Orchestrator.collectGaps({ steps, context: parsed.context })
    if (gaps.length > 0) {
      log.warn("swarm: unresolved gaps", { gaps })
    }

    // Phase 2: Schedule steps in dependency waves
    const waves = schedule(steps)
    log.info("swarm: scheduled", { waves: waves.length, totalSteps: steps.length })

    // Phase 3: Execute waves sequentially (steps within a wave can run in parallel)
    const outputs: Record<string, string> = {}
    const results: StepResult[] = []

    for (const wave of waves) {
      const waveResults = await Promise.all(
        wave.map(async (step) => {
          step.status = "running"
          let output = ""
          let verdict: ReviewVerdict | undefined
          let retries = 0

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              output = await runStep({
                step,
                parentSessionID: input.sessionID,
                context: parsed.context.refs,
                previousOutputs: outputs,
              })
            } catch (err) {
              log.error("swarm: step execution failed", { stepID: step.id, error: String(err) })
              step.status = "failed"
              return { step, output: String(err), review: undefined, retries: attempt }
            }

            // Run reviewer if enabled and not last retry
            if (reviewEnabled && attempt < maxRetries) {
              try {
                verdict = await review({ step, output, parentSessionID: input.sessionID })
              } catch (err) {
                log.warn("swarm: reviewer failed, treating as approved", { stepID: step.id, error: String(err) })
                verdict = { approved: true, issues: [], summary: "Reviewer unavailable" }
              }

              if (verdict.approved) {
                step.status = "done"
                break
              }

              log.info("swarm: reviewer requested revisions", {
                stepID: step.id,
                attempt: attempt + 1,
                issues: verdict.issues.length,
              })
              retries = attempt + 1

              // Append reviewer feedback to context for next attempt
              parsed.context.refs[`reviewer-feedback-${step.id}`] = [
                `Reviewer feedback (attempt ${attempt + 1}):`,
                `VERDICT: revise`,
                `ISSUES:`,
                ...verdict.issues.map((i) => `  - ${i}`),
                `SUMMARY: ${verdict.summary}`,
              ].join("\n")
            } else {
              step.status = "done"
              break
            }
          }

          outputs[step.id] = output
          return { step, output, review: verdict, retries }
        }),
      )

      results.push(...waveResults)

      // Abort if any step in the wave failed
      if (waveResults.some((r) => r.step.status === "failed")) {
        log.warn("swarm: aborting due to failed step in wave")
        break
      }
    }

    const failed = results.filter((r) => r.step.status === "failed")
    const status = failed.length === 0 ? "done" : results.some((r) => r.step.status === "done") ? "partial" : "failed"

    const summary = [
      `Job ${jobID}: ${status === "done" ? "All steps completed" : `${failed.length} step(s) failed`}`,
      `Steps: ${results.length}/${steps.length} executed`,
      ...results.map((r) => `  ${r.step.id}: ${r.step.status}${r.review ? ` (review: ${r.review.approved ? "approved" : "revise"})` : ""}`),
    ].join("\n")

    log.info("swarm: completed", { jobID, status, steps: results.length })

    return { jobID, task: input.task, steps: results, status, summary }
  }
}

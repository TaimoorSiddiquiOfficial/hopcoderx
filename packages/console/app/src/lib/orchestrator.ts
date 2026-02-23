import { AgentContext } from "./agent-context"

export namespace Orchestrator {
  export type DecomposeResult = {
    steps: Omit<AgentContext.Step, "model" | "status" | "output" | "tokens" | "cost">[]
    context: AgentContext.Info["context"]
  }

  export const DECOMPOSE_SYSTEM = `You are an AI orchestration planner. Given a user task, break it into concrete step-by-step subtasks that can each be handled independently by a coding AI agent.

Return ONLY valid JSON (no markdown, no explanation):
{
  "steps": [
    {
      "id": "step-1",
      "task": "<specific subtask>",
      "agent": "build",
      "depends_on": [],
      "refs": ["<file or URL this step needs>"],
      "gaps": ["<info missing to complete this step>"]
    }
  ],
  "context": {
    "refs": {},
    "gaps": ["<overall missing context>"]
  }
}

Rules:
- Keep steps atomic — each completable in one agent session
- Use depends_on to express ordering (step IDs of prerequisites)
- refs = file paths or URLs the step needs to read
- gaps = info the user must provide before this step can run
- agent is always "build" unless purely planning (use "plan")
- Maximum 12 steps`

  export function decomposePrompt(task: string, context: Record<string, string>) {
    const ctxStr = Object.entries(context)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")
    return ctxStr ? `Task: ${task}\n\nContext provided:\n${ctxStr}` : `Task: ${task}`
  }

  export function parseJson<T>(raw: string): T {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()
    return JSON.parse(clean) as T
  }

  export function assignModels(
    steps: DecomposeResult["steps"],
    tier: AgentContext.Info["tier"] = "free",
  ): AgentContext.Step[] {
    const tried: string[] = []
    return steps.map((step) => {
      const m = AgentContext.nextFreeModel(tried)?.model ?? AgentContext.FREE_MODELS[0].model
      return { ...step, model: m, status: "pending" as const }
    })
  }

  export function fillGaps(steps: AgentContext.Step[], provided: Record<string, string>): AgentContext.Step[] {
    const keys = Object.keys(provided).map((k) => k.toLowerCase())
    return steps.map((step) => ({
      ...step,
      gaps: step.gaps.filter((gap) => !keys.some((k) => gap.toLowerCase().includes(k))),
    }))
  }

  export function collectGaps(result: { steps: AgentContext.Step[]; context: AgentContext.Info["context"] }): string[] {
    return [...new Set([...result.context.gaps, ...result.steps.flatMap((s) => s.gaps)])]
  }

  export function jobId(): string {
    return Math.random().toString(16).slice(2, 9)
  }
}

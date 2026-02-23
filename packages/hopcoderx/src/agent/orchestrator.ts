import { AgentContext } from "./context"

// System prompt for task decomposition
const DECOMPOSE_SYSTEM = `You are an AI orchestration planner. Given a user task, break it into concrete step-by-step subtasks that can each be handled independently by a coding AI agent.

Return ONLY valid JSON matching this schema (no markdown, no explanation):
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
- Keep steps atomic — each should be completable in one agent session
- Use depends_on to express ordering (step IDs of prerequisites)
- refs = file paths or URLs the step needs to read
- gaps = info the user must provide before this step can run
- agent is always "build" unless the step is purely planning (use "plan")
- Maximum 12 steps`

// System prompt for gap detection
const GAP_SYSTEM = `You are reviewing a set of agent steps for a coding task. For each step, identify missing information (gaps) that would prevent the step from completing.

Return ONLY valid JSON:
{
  "gaps": {
    "step-1": ["<missing info>"],
    "step-2": []
  }
}`

export namespace Orchestrator {
  export type DecomposeResult = {
    steps: Omit<AgentContext.Step, "model" | "status" | "output" | "tokens" | "cost">[]
    context: AgentContext.Info["context"]
  }

  // Select the cheapest eligible model for the tier, avoiding tried providers
  export function assignModels(
    steps: DecomposeResult["steps"],
    tier: AgentContext.Info["tier"] = "free",
    triedModels: string[] = [],
  ): AgentContext.Step[] {
    return steps.map((step) => {
      const model = AgentContext.nextFreeModel(triedModels)?.model ?? AgentContext.FREE_MODELS[0].model
      return {
        ...step,
        model,
        status: "pending" as const,
      }
    })
  }

  // Parse LLM JSON response — tolerant of markdown fences
  export function parseJson<T>(raw: string): T {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()
    return JSON.parse(clean) as T
  }

  // Build the decompose user prompt
  export function decomposePrompt(task: string, context: Record<string, string>) {
    const ctxStr = Object.entries(context)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")
    return ctxStr ? `Task: ${task}\n\nContext provided:\n${ctxStr}` : `Task: ${task}`
  }

  // Merge user-supplied context into step gaps (removes gaps that are now answered)
  export function fillGaps(steps: AgentContext.Step[], provided: Record<string, string>): AgentContext.Step[] {
    const keys = Object.keys(provided).map((k) => k.toLowerCase())
    return steps.map((step) => ({
      ...step,
      gaps: step.gaps.filter((gap) => !keys.some((k) => gap.toLowerCase().includes(k))),
    }))
  }

  // Collect all unfilled gaps across steps + context
  export function collectGaps(result: { steps: AgentContext.Step[]; context: AgentContext.Info["context"] }): string[] {
    const stepGaps = result.steps.flatMap((s) => s.gaps)
    return [...new Set([...result.context.gaps, ...stepGaps])]
  }

  // Generate a short commit-hash-style job ID (7 hex chars)
  export function jobId(): string {
    return Math.random().toString(16).slice(2, 9)
  }
}

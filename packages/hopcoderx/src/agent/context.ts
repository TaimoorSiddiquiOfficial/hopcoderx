import z from "zod"

export namespace AgentContext {
  export const Step = z.object({
    id: z.string(),
    task: z.string(),
    model: z.string(),
    agent: z.string(),
    depends_on: z.array(z.string()),
    refs: z.array(z.string()),
    gaps: z.array(z.string()),
    status: z.enum(["pending", "running", "done", "failed"]),
    output: z.string().optional(),
    tokens: z.number().int().optional(),
    cost: z.number().optional(),
  })
  export type Step = z.infer<typeof Step>

  export const Info = z.object({
    $schema: z.string().optional(),
    task: z.string(),
    steps: z.array(Step),
    context: z.object({
      refs: z.record(z.string(), z.string()),
      gaps: z.array(z.string()),
    }),
    tier: z.enum(["free", "mini", "pro", "engineer"]).optional(),
    created_at: z.number(),
  })
  export type Info = z.infer<typeof Info>

  // Free model rotation order — most reliable free APIs first
  export const FREE_MODELS = [
    { provider: "groq", model: "llama-3.3-70b-versatile", rpm: 30 },
    { provider: "cerebras", model: "llama3.1-70b", rpm: 30 },
    { provider: "google", model: "gemini-2.0-flash-exp", rpm: 15 },
    { provider: "together", model: "Qwen/Qwen2.5-72B-Instruct-Turbo", rpm: 60 },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", rpm: 20 },
  ] as const

  // Context limit in tokens per free model (above this → escalate tier)
  export const FREE_CONTEXT_LIMITS: Record<string, number> = {
    "llama-3.3-70b-versatile": 128_000,
    "llama3.1-70b": 128_000,
    "gemini-2.0-flash-exp": 1_000_000,
    "Qwen/Qwen2.5-72B-Instruct-Turbo": 32_768,
    "meta-llama/llama-3.3-70b-instruct:free": 65_536,
  }

  export function empty(task: string, tier: Info["tier"] = "free"): Info {
    return {
      $schema: "https://hopcoder.dev/agent-context.json",
      task,
      steps: [],
      context: { refs: {}, gaps: [] },
      tier,
      created_at: Date.now(),
    }
  }

  export function nextFreeModel(tried: string[]): (typeof FREE_MODELS)[number] | undefined {
    return FREE_MODELS.find((m) => !tried.includes(m.model))
  }

  export function modelForTier(tier: Info["tier"] = "free"): string {
    if (tier === "free" || tier === "mini") return FREE_MODELS[0].model
    return FREE_MODELS[0].model // pro/engineer still use free first
  }
}

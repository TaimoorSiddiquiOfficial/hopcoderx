// Shared AgentContext types — mirrors packages/hopcoderx/src/agent/context.ts
// Kept as a standalone lib so the console Cloudflare worker has no cross-package deps

export namespace AgentContext {
  export type StepStatus = "pending" | "running" | "done" | "failed"

  export type Step = {
    id: string
    task: string
    model: string
    agent: string
    depends_on: string[]
    refs: string[]
    gaps: string[]
    status: StepStatus
    output?: string
    tokens?: number
    cost?: number
  }

  export type Info = {
    $schema?: string
    task: string
    steps: Step[]
    context: { refs: Record<string, string>; gaps: string[] }
    tier?: "free" | "mini" | "pro" | "engineer"
    created_at: number
  }

  // First entry: OpenRouter Preset — create at https://openrouter.ai/settings/presets
  // Name it "hopcoder-free" and add free providers (Groq, Cerebras, Gemini, Together).
  // OpenRouter handles load-balancing + fallback + rate-limit retry automatically.
  export const FREE_MODELS = [
    { provider: "openrouter", model: "@preset/hopcoder-free", rpm: 0 },
    { provider: "groq", model: "groq/llama-3.3-70b-versatile", rpm: 30 },
    { provider: "cerebras", model: "cerebras/llama3.1-70b", rpm: 30 },
    { provider: "google", model: "google/gemini-2.0-flash-exp", rpm: 15 },
    { provider: "together", model: "together/Qwen/Qwen2.5-72B-Instruct-Turbo", rpm: 60 },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", rpm: 20 },
  ] as const

  export function nextFreeModel(tried: string[]) {
    return FREE_MODELS.find((m) => !tried.includes(m.model))
  }
}

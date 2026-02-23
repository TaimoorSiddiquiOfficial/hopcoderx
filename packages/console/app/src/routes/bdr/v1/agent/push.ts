import type { APIEvent } from "@solidjs/start/server"
import { Database, eq, isNull, and } from "@hopcoderx/console-core/drizzle/index.js"
import { KeyTable } from "@hopcoderx/console-core/schema/key.sql.js"
import { BillingTable } from "@hopcoderx/console-core/schema/billing.sql.js"
import { AgentJobTable } from "@hopcoderx/console-core/schema/agent-job.sql.js"
import { WorkspaceTable } from "@hopcoderx/console-core/schema/workspace.sql.js"
import type { AgentContext } from "~/lib/agent-context"
import { Orchestrator } from "~/lib/orchestrator"

// Tier derived from subscription plan
function tierFromPlan(plan: string | null | undefined): AgentContext.Info["tier"] {
  if (plan === "engineer") return "engineer"
  if (plan === "pro" || plan === "200" || plan === "100") return "pro"
  if (plan === "mini" || plan === "20") return "mini"
  return "free"
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type" },
  })
}

export async function POST(input: APIEvent) {
  try {
    const apiKey = input.request.headers.get("authorization")?.split(" ")[1]
    if (!apiKey) return new Response(JSON.stringify({ error: "Missing API key" }), { status: 401 })

    const body = await input.request.json()
    const task: string = body.task
    const provided: Record<string, string> = body.context ?? {}
    if (!task?.trim()) return new Response(JSON.stringify({ error: "task is required" }), { status: 400 })

    // Resolve workspace + billing tier from API key
    const auth = await Database.use((tx) =>
      tx
        .select({
          workspaceID: KeyTable.workspaceID,
          plan: BillingTable.subscription,
        })
        .from(KeyTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
        .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((r) => r[0]),
    )
    if (!auth) return new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 })

    const tier = tierFromPlan(auth.plan?.plan)

    // Decompose task via free model (Groq) — POST to our own BDR gateway
    const decomposeRes = await fetch(`https://${input.request.headers.get("host")}/bdr/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-agent-push": "1",
      },
      body: JSON.stringify({
        model: "groq/llama-3.3-70b-versatile",
        stream: false,
        messages: [
          { role: "system", content: Orchestrator.DECOMPOSE_SYSTEM },
          { role: "user", content: Orchestrator.decomposePrompt(task, provided) },
        ],
      }),
    })

    let decomposed: Orchestrator.DecomposeResult
    if (decomposeRes.ok) {
      const completion = await decomposeRes.json()
      const raw = completion.choices?.[0]?.message?.content ?? "{}"
      try {
        decomposed = Orchestrator.parseJson<Orchestrator.DecomposeResult>(raw)
      } catch {
        decomposed = { steps: [], context: { refs: {}, gaps: ["Could not parse decomposition output"] } }
      }
    } else {
      // Fallback: single-step job if decomposition fails
      decomposed = {
        steps: [{ id: "step-1", task, agent: "build", depends_on: [], refs: [], gaps: [] }],
        context: { refs: {}, gaps: [] },
      }
    }

    // Assign models based on tier
    const steps = Orchestrator.assignModels(decomposed.steps, tier)
    // Fill gaps from user-provided context
    const filledSteps = provided && Object.keys(provided).length ? Orchestrator.fillGaps(steps, provided) : steps
    const gaps = Orchestrator.collectGaps({ steps: filledSteps, context: decomposed.context })

    const jobId = Orchestrator.jobId()
    const workspaceID = auth.workspaceID
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 26)

    const ctx: AgentContext.Info = {
      $schema: "https://hopcoder.dev/agent-context.json",
      task,
      steps: filledSteps,
      context: { ...decomposed.context, refs: { ...decomposed.context.refs, ...provided } },
      tier,
      created_at: Date.now(),
    }

    await Database.use((tx) =>
      tx.insert(AgentJobTable).values({
        id,
        workspaceID,
        task,
        tier,
        status: gaps.length > 0 ? "queued" : "queued",
        step_count: filledSteps.length,
        models_used: [...new Set(filledSteps.map((s) => s.model))],
        total_tokens: 0,
        total_cost: 0,
        context: ctx,
      }),
    )

    return new Response(
      JSON.stringify({
        jobId: id,
        shortId: jobId,
        tier,
        steps: filledSteps,
        gaps,
        status: "queued",
        _schema: "https://hopcoder.dev/agent-context.json",
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), { status: 500 })
  }
}

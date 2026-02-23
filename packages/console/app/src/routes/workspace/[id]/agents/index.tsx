import { createSignal, createResource, For, Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { query, action, json } from "@solidjs/router"
import { withActor } from "~/context/auth.withActor"
import { Database, desc, eq, and } from "@hopcoderx/console-core/drizzle/index.js"
import { AgentJobTable } from "@hopcoderx/console-core/schema/agent-job.sql.js"
import { Actor } from "@hopcoderx/console-core/actor.js"

// Server query — fetch recent agent jobs
const queryJobs = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return Database.use((tx) =>
      tx
        .select()
        .from(AgentJobTable)
        .where(eq(AgentJobTable.workspaceID, workspaceID))
        .orderBy(desc(AgentJobTable.timeCreated))
        .limit(50)
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            task: r.task,
            tier: r.tier,
            status: r.status,
            step_count: r.step_count,
            total_tokens: r.total_tokens,
            total_cost: r.total_cost,
            models_used: r.models_used ?? [],
            created_at: r.timeCreated?.toISOString() ?? "",
            steps: r.context?.steps ?? [],
            gaps: r.context?.context.gaps ?? [],
          })),
        ),
    )
  })
}, "agent-jobs")

// Chip color by model provider
function modelChipColor(model: string) {
  if (model.startsWith("groq/") || model.startsWith("cerebras/") || model.includes(":free") || model.startsWith("together/") || model.startsWith("google/gemini"))
    return "#16a34a" // green = free
  if (model.includes("mini") || model.includes("flash") || model.includes("haiku"))
    return "#d97706" // amber = mini
  return "#dc2626" // red = paid
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function shortId(id: string) {
  return id.slice(-7)
}

export default function AgentsPage() {
  const params = useParams()
  const [jobs, { refetch }] = createResource(() => queryJobs(params.id!))
  const [task, setTask] = createSignal("")
  const [context, setContext] = createSignal("")
  const [gaps, setGaps] = createSignal<string[]>([])
  const [gapAnswers, setGapAnswers] = createSignal<Record<string, string>>({})
  const [pushing, setPushing] = createSignal(false)
  const [pushError, setPushError] = createSignal("")
  const [expandedJob, setExpandedJob] = createSignal<string | null>(null)

  async function onPush() {
    if (!task().trim() || pushing()) return
    setPushing(true)
    setPushError("")
    setGaps([])
    try {
      const ctxParsed: Record<string, string> = {}
      try {
        if (context().trim()) Object.assign(ctxParsed, JSON.parse(context()))
      } catch {}
      Object.assign(ctxParsed, gapAnswers())

      const res = await fetch(`/bdr/v1/agent/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: task(), context: ctxParsed }),
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) {
        setPushError(data.error ?? "Push failed")
        return
      }
      if (data.gaps?.length > 0) {
        setGaps(data.gaps)
        return
      }
      setTask("")
      setContext("")
      setGapAnswers({})
      refetch()
    } catch (e: any) {
      setPushError(e.message ?? "Network error")
    } finally {
      setPushing(false)
    }
  }

  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">

        {/* Push Queue */}
        <section style={{ padding: "24px", "border-bottom": "1px solid var(--color-border)" }}>
          <h2 style={{ "font-size": "14px", "font-weight": 600, margin: "0 0 12px" }}>Agent Push</h2>
          <textarea
            placeholder="Describe the task for your agent… e.g. 'Refactor the auth module to use JWT, add unit tests'"
            value={task()}
            onInput={(e) => setTask(e.currentTarget.value)}
            rows={3}
            style={{
              width: "100%",
              "box-sizing": "border-box",
              padding: "10px 12px",
              "border-radius": "6px",
              border: "1px solid var(--color-border)",
              background: "var(--color-background)",
              color: "var(--color-text)",
              "font-size": "13px",
              resize: "vertical",
            }}
          />

          {/* Gap answers */}
          <Show when={gaps().length > 0}>
            <div style={{ margin: "12px 0", padding: "12px", background: "var(--color-surface)", "border-radius": "6px" }}>
              <p style={{ "font-size": "12px", "font-weight": 600, margin: "0 0 8px", color: "var(--color-warning)" }}>
                Missing context — fill in to proceed:
              </p>
              <For each={gaps()}>
                {(gap) => (
                  <div style={{ margin: "6px 0" }}>
                      <label style={{ "font-size": "12px", color: "var(--color-text-secondary)", display: "block", "margin-bottom": "4px" }}>
                      {gap}
                    </label>
                    <input
                      type="text"
                      placeholder="Your answer…"
                      value={gapAnswers()[gap] ?? ""}
                      onInput={(e) => setGapAnswers({ ...gapAnswers(), [gap]: e.currentTarget.value })}
                      style={{
                        width: "100%",
                        "box-sizing": "border-box",
                        padding: "6px 10px",
                        "border-radius": "4px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-background)",
                        color: "var(--color-text)",
                        "font-size": "12px",
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={pushError()}>
            <p style={{ color: "var(--color-error)", "font-size": "12px", margin: "8px 0" }}>{pushError()}</p>
          </Show>

          <button
            onClick={onPush}
            disabled={pushing() || !task().trim()}
            style={{
              "margin-top": "10px",
              padding: "8px 18px",
              background: "var(--color-primary)",
              color: "#fff",
              border: "none",
              "border-radius": "6px",
              "font-size": "13px",
              cursor: pushing() ? "not-allowed" : "pointer",
              opacity: pushing() || !task().trim() ? 0.6 : 1,
            }}
          >
            {pushing() ? "Pushing…" : "Push to Agent"}
          </button>
        </section>

        {/* Commit-style Audit Log */}
        <section style={{ padding: "24px" }}>
          <h2 style={{ "font-size": "14px", "font-weight": 600, margin: "0 0 16px" }}>Agent Runs</h2>
          <Show when={jobs.loading}>
            <p style={{ color: "var(--color-text-secondary)", "font-size": "13px" }}>Loading…</p>
          </Show>
          <Show when={!jobs.loading && (!jobs() || jobs()!.length === 0)}>
            <p style={{ color: "var(--color-text-secondary)", "font-size": "13px" }}>No agent runs yet. Push a task above.</p>
          </Show>
          <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
            <For each={jobs()}>
              {(job) => {
                const expanded = createMemo(() => expandedJob() === job.id)
                return (
                  <div
                    style={{
                      padding: "10px 12px",
                      "border-radius": "6px",
                      border: "1px solid var(--color-border)",
                      cursor: "pointer",
                      background: expanded() ? "var(--color-surface)" : "transparent",
                      transition: "background 0.1s",
                    }}
                    onClick={() => setExpandedJob(expanded() ? null : job.id)}
                  >
                    {/* Log summary row */}
                    <div style={{ display: "flex", "align-items": "center", gap: "10px", "flex-wrap": "wrap" }}>
                      <code style={{ "font-size": "12px", color: "var(--color-text-secondary)", "min-width": "58px" }}>
                        {shortId(job.id)}
                      </code>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          "border-radius": "3px",
                          "font-size": "10px",
                          background: job.status === "done" ? "#16a34a22" : job.status === "failed" ? "#dc262622" : "#d9770622",
                          color: job.status === "done" ? "#16a34a" : job.status === "failed" ? "#dc2626" : "#d97706",
                        }}
                      >
                        {job.status}
                      </span>
                      <span style={{ "font-size": "13px", flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {job.task}
                      </span>
                      <For each={(job.models_used as string[]).slice(0, 2)}>
                        {(m) => (
                          <span style={{
                            display: "inline-block",
                            padding: "1px 6px",
                            "border-radius": "3px",
                            "font-size": "10px",
                            border: `1px solid ${modelChipColor(m)}`,
                            color: modelChipColor(m),
                          }}>
                            {m.split("/").pop()}
                          </span>
                        )}
                      </For>
                      <span style={{ "font-size": "11px", color: "var(--color-text-secondary)", "white-space": "nowrap" }}>
                        {job.step_count} steps · {job.total_tokens.toLocaleString()} tok · ${(job.total_cost / 100_000_000).toFixed(4)} · {relativeTime(job.created_at)}
                      </span>
                    </div>

                    {/* Expanded step breakdown */}
                    <Show when={expanded()}>
                      <div style={{ "margin-top": "10px", "padding-top": "10px", "border-top": "1px solid var(--color-border)" }}>
                        <For each={job.steps as any[]}>
                          {(step) => (
                            <div style={{
                              display: "flex",
                              gap: "8px",
                              padding: "6px 0",
                              "border-bottom": "1px solid var(--color-border-light)",
                              "align-items": "flex-start",
                            }}>
                              <code style={{ "font-size": "11px", color: "var(--color-text-secondary)", "min-width": "52px" }}>
                                {step.id}
                              </code>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "1px 5px",
                                  "border-radius": "3px",
                                  "font-size": "10px",
                                  background: step.status === "done" ? "#16a34a22" : step.status === "failed" ? "#dc262622" : "#88888822",
                                  color: step.status === "done" ? "#16a34a" : step.status === "failed" ? "#dc2626" : "#888",
                                }}
                              >
                                {step.status}
                              </span>
                              <span style={{ flex: 1, "font-size": "12px" }}>{step.task}</span>
                              <span style={{
                                "font-size": "10px",
                                padding: "1px 5px",
                                "border-radius": "3px",
                                border: `1px solid ${modelChipColor(step.model)}`,
                                color: modelChipColor(step.model),
                              }}>
                                {step.model.split("/").pop()}
                              </span>
                              <Show when={step.gaps?.length > 0}>
                                <span style={{ "font-size": "10px", color: "var(--color-warning)" }}>⚠ {step.gaps.join("; ")}</span>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </section>
      </div>
    </div>
  )
}

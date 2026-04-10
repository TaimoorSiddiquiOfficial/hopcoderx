/**
 * Linear channel for HopCoderX.
 *
 * Connects Linear issue tracking to the coding agent:
 *   - Receive new issues → auto-create coding sessions
 *   - Update issue status when agent completes work
 *   - Add comments to issues with agent output
 *   - Prioritize by urgency/priority
 *
 * Setup:
 *   LINEAR_API_KEY=lin_api_xxx      (Linear API key)
 *   LINEAR_TEAM_ID=TEAM_ID          (optional: filter to specific team)
 *   LINEAR_POLL=60                   (seconds between polls)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

const PRIORITY_NAMES: Record<number, string> = { 0: "no", 1: "urgent", 2: "high", 3: "medium", 4: "low" }

export class LinearChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "linear",
    name: "Linear",
    envVars: ["LINEAR_API_KEY"],
    canReceive: true,
    canSend: true,
  }

  private apiKey = process.env.LINEAR_API_KEY ?? ""
  private teamId = process.env.LINEAR_TEAM_ID
  private pollMs = parseInt(process.env.LINEAR_POLL ?? "60", 10) * 1000
  private handlers: Handler[] = []
  private _interval?: NodeJS.Timer
  private seenIds = new Set<string>()

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    try {
      const issues = await this.fetchIssues("triage")
      for (const i of issues) this.seenIds.add(i.id)
    } catch {}
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    this._interval = setInterval(() => void this.poll(), this.pollMs)
  }

  async stopListening(): Promise<void> {
    if (this._interval) clearInterval(this._interval as any)
  }

  private async gql<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`Linear API error: ${res.status}`)
    const data = (await res.json()) as { data: T; errors?: any[] }
    if (data.errors?.length) throw new Error(data.errors.map((e: any) => e.message).join("; "))
    return data.data
  }

  private async fetchIssues(stateType = "unstarted"): Promise<any[]> {
    const teamFilter = this.teamId ? `, { team: { id: { eq: "${this.teamId}" } } }` : ""
    const data = await this.gql<{ issues: { nodes: any[] } }>(`
      query {
        issues(filter: { state: { type: { eq: "${stateType}" } }${teamFilter} }, first: 25, orderBy: updatedAt) {
          nodes {
            id identifier title description priority state { name } team { name }
            assignee { name } labels { nodes { name } } url updatedAt
          }
        }
      }
    `)
    return data.issues.nodes
  }

  private async poll(): Promise<void> {
    try {
      const issues = await this.fetchIssues("triage")
      for (const issue of issues) {
        if (this.seenIds.has(issue.id)) continue
        this.seenIds.add(issue.id)
        const priority = PRIORITY_NAMES[issue.priority] ?? "none"
        const labels = issue.labels?.nodes?.map((l: any) => l.name).join(", ") || "none"
        const msg: ChannelMessage = {
          id: issue.id,
          channelId: "linear",
          threadId: issue.id,
          from: issue.team?.name ?? "Linear",
          text: `📋 [${priority.toUpperCase()} priority] ${issue.identifier}: ${issue.title}\nTeam: ${issue.team?.name}\nLabels: ${labels}\nState: ${issue.state?.name}\n${issue.description ? `\nDescription:\n${issue.description.slice(0, 500)}` : ""}\n\nURL: ${issue.url}`,
          raw: issue,
          timestamp: Date.now(),
        }
        for (const h of this.handlers) await h(msg)
      }
    } catch (e) {
      console.warn("[linear channel] poll error:", e)
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Linear channel not configured")
    // `to` format: "issue:<issueId>" or "comment:<issueId>"
    const [action, issueId] = to.split(":", 2)

    if (action === "comment" || action === "issue") {
      await this.gql(`
        mutation CreateComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
          }
        }
      `, { issueId, body: reply.text })
      return
    }

    if (action === "complete") {
      // Move issue to completed state
      const data = await this.gql<{ workflowStates: { nodes: any[] } }>(`
        query { workflowStates(filter: { type: { eq: "completed" } }, first: 1) { nodes { id } } }
      `)
      const stateId = data.workflowStates.nodes[0]?.id
      if (stateId) {
        await this.gql(`
          mutation UpdateIssue($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) { success }
          }
        `, { id: issueId, stateId })
      }
      return
    }

    throw new Error(`Invalid Linear target: ${to}. Use comment:<id>, issue:<id>, or complete:<id>`)
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}

/**
 * GitHub Issues channel for HopCoderX.
 *
 * Connects GitHub Issues/Notifications to the coding agent:
 *   - Receive new issues → auto-create coding session
 *   - Receive PR comments → respond with code suggestions
 *   - Post agent replies as GitHub comments
 *   - React to issues with status emojis
 *
 * Setup:
 *   GITHUB_CHANNEL_TOKEN=ghp_xxx   (Personal Access Token with repo scope)
 *   GITHUB_CHANNEL_REPO=owner/repo (target repository)
 *   GITHUB_CHANNEL_POLL=30         (seconds between polls, default 30)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface GitHubIssueEvent {
  id: number
  action: string
  issue?: { id: number; number: number; title: string; body: string; user: { login: string }; html_url: string }
  comment?: { id: number; body: string; user: { login: string }; html_url: string }
  pull_request?: { id: number; number: number; title: string; body: string; user: { login: string } }
  repository?: { full_name: string }
}

export class GitHubIssuesChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "github-issues",
    name: "GitHub Issues",
    envVars: ["GITHUB_CHANNEL_TOKEN", "GITHUB_CHANNEL_REPO"],
    canReceive: true,
    canSend: true,
  }

  private token = process.env.GITHUB_CHANNEL_TOKEN ?? ""
  private repo = process.env.GITHUB_CHANNEL_REPO ?? ""
  private pollInterval = parseInt(process.env.GITHUB_CHANNEL_POLL ?? "30", 10) * 1000
  private handlers: Handler[] = []
  private _interval?: NodeJS.Timer
  private seenIds = new Set<string>()

  isAvailable(): boolean {
    return !!(this.token && this.repo)
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    // Load existing notifications to avoid re-processing old ones
    try {
      const existing = await this.fetchNotifications()
      for (const n of existing) this.seenIds.add(String(n.id))
    } catch {}
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    this._interval = setInterval(() => void this.poll(), this.pollInterval)
  }

  async stopListening(): Promise<void> {
    if (this._interval) clearInterval(this._interval as any)
  }

  private async fetchNotifications(): Promise<any[]> {
    const res = await fetch("https://api.github.com/notifications?all=false&participating=true", {
      headers: { Authorization: `token ${this.token}`, Accept: "application/vnd.github.v3+json" },
    })
    if (!res.ok) return []
    return (await res.json()) as any[]
  }

  private async poll(): Promise<void> {
    try {
      const notifications = await this.fetchNotifications()
      for (const n of notifications) {
        const key = `${n.subject.type}:${n.id}:${n.updated_at}`
        if (this.seenIds.has(key)) continue
        this.seenIds.add(key)

        const msg: ChannelMessage = {
          id: String(n.id),
          channelId: "github-issues",
          threadId: `${n.repository.full_name}/${n.subject.type.toLowerCase()}`,
          from: n.repository.full_name,
          text: `[${n.subject.type}] ${n.subject.title}`,
          raw: n,
          timestamp: Date.now(),
        }
        for (const h of this.handlers) await h(msg)
      }
    } catch (e) {
      console.warn("[github-issues channel] poll error:", e)
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("GitHub channel not configured")
    // `to` format: "owner/repo/issues/123" or "owner/repo/pulls/123"
    const parts = to.split("/")
    if (parts.length < 4) throw new Error(`Invalid GitHub target: ${to}. Expected: owner/repo/issues/123`)
    const [owner, repo, type, number] = parts
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`
    const endpoint = type === "pulls" ? `${apiBase}/issues/${number}/comments` : `${apiBase}/issues/${number}/comments`

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: reply.text }),
    })
    if (!res.ok) throw new Error(`GitHub comment failed: ${res.status} ${await res.text()}`)
  }

  /** Convenience: fetch issue details */
  async getIssue(owner: string, repo: string, number: number): Promise<any> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
      headers: { Authorization: `token ${this.token}`, Accept: "application/vnd.github.v3+json" },
    })
    if (!res.ok) throw new Error(`Failed to fetch issue: ${res.status}`)
    return res.json()
  }

  /** List open issues for the configured repo */
  async listOpenIssues(maxPages = 2): Promise<any[]> {
    const issues: any[] = []
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/issues?state=open&per_page=30&page=${page}`, {
        headers: { Authorization: `token ${this.token}`, Accept: "application/vnd.github.v3+json" },
      })
      if (!res.ok) break
      const batch = (await res.json()) as any[]
      issues.push(...batch)
      if (batch.length < 30) break
    }
    return issues
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}

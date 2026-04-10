/**
 * PagerDuty channel for HopCoderX.
 *
 * Receive incident alerts → auto-diagnose + fix via coding agent.
 * Acknowledge/resolve incidents from the agent.
 *
 * Setup:
 *   PAGERDUTY_API_KEY=u+xxxx          (PagerDuty API key — Events v2 or REST API)
 *   PAGERDUTY_ROUTING_KEY=xxxx        (Events v2 routing key for sending events)
 *   PAGERDUTY_SERVICE_IDS=P1,P2       (comma-sep service IDs to watch, empty = all)
 *   PAGERDUTY_POLL=60                  (seconds between polls, default 60)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface PDIncident {
  id: string
  incident_number: number
  title: string
  status: string
  urgency: string
  service: { id: string; summary: string }
  body?: { details?: string }
  created_at: string
  html_url: string
}

export class PagerDutyChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "pagerduty",
    name: "PagerDuty",
    envVars: ["PAGERDUTY_API_KEY"],
    canReceive: true,
    canSend: true,
  }

  private apiKey = process.env.PAGERDUTY_API_KEY ?? ""
  private routingKey = process.env.PAGERDUTY_ROUTING_KEY ?? ""
  private serviceIds = new Set((process.env.PAGERDUTY_SERVICE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  private pollMs = parseInt(process.env.PAGERDUTY_POLL ?? "60", 10) * 1000
  private handlers: Handler[] = []
  private _interval?: NodeJS.Timer
  private seenIds = new Set<string>()

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    // Pre-populate seen incidents to avoid re-processing on first poll
    try {
      const incidents = await this.fetchIncidents()
      for (const i of incidents) this.seenIds.add(i.id)
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

  private async fetchIncidents(): Promise<PDIncident[]> {
    const params = new URLSearchParams()
    params.append("statuses[]", "triggered")
    params.append("statuses[]", "acknowledged")
    params.set("limit", "25")
    if (this.serviceIds.size > 0) {
      for (const id of this.serviceIds) params.append("service_ids[]", id)
    }
    const res = await fetch(`https://api.pagerduty.com/incidents?${params}`, {
      headers: { Authorization: `Token token=${this.apiKey}`, Accept: "application/vnd.pagerduty+json;version=2" },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { incidents: PDIncident[] }
    return data.incidents ?? []
  }

  private async poll(): Promise<void> {
    try {
      const incidents = await this.fetchIncidents()
      for (const inc of incidents) {
        if (this.seenIds.has(inc.id)) continue
        this.seenIds.add(inc.id)

        const msg: ChannelMessage = {
          id: inc.id,
          channelId: "pagerduty",
          threadId: inc.id,
          from: `pagerduty:${inc.service.id}`,
          text: `🚨 [${inc.urgency.toUpperCase()}] Incident #${inc.incident_number}: ${inc.title}\nService: ${inc.service.summary}\nStatus: ${inc.status}\nURL: ${inc.html_url}${inc.body?.details ? `\n\nDetails:\n${inc.body.details}` : ""}`,
          raw: inc,
          timestamp: Date.now(),
        }
        for (const h of this.handlers) await h(msg)
      }
    } catch (e) {
      console.warn("[pagerduty channel] poll error:", e)
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("PagerDuty channel not configured")

    // `to` can be:
    //   "acknowledge:<incident_id>"  → acknowledge the incident
    //   "resolve:<incident_id>"      → resolve the incident
    //   "note:<incident_id>"         → add a note
    //   "event"                      → send a custom event via Events v2 API
    const [action, incidentId] = to.split(":", 2)

    if (action === "event") {
      if (!this.routingKey) throw new Error("PAGERDUTY_ROUTING_KEY not set")
      await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: this.routingKey,
          event_action: "trigger",
          payload: { summary: reply.text, severity: "info", source: "hopcoderx" },
        }),
      })
      return
    }

    if (!incidentId) throw new Error(`Invalid PagerDuty target: ${to}`)

    if (action === "note") {
      const res = await fetch(`https://api.pagerduty.com/incidents/${incidentId}/notes`, {
        method: "POST",
        headers: {
          Authorization: `Token token=${this.apiKey}`,
          Accept: "application/vnd.pagerduty+json;version=2",
          "Content-Type": "application/json",
          From: "hopcoderx@dev",
        },
        body: JSON.stringify({ note: { content: reply.text } }),
      })
      if (!res.ok) throw new Error(`PagerDuty note failed: ${res.status}`)
      return
    }

    if (action === "acknowledge" || action === "resolve") {
      const status = action === "resolve" ? "resolved" : "acknowledged"
      const res = await fetch(`https://api.pagerduty.com/incidents`, {
        method: "PUT",
        headers: {
          Authorization: `Token token=${this.apiKey}`,
          Accept: "application/vnd.pagerduty+json;version=2",
          "Content-Type": "application/json",
          From: "hopcoderx@dev",
        },
        body: JSON.stringify({ incidents: [{ id: incidentId, type: "incident_reference", status }] }),
      })
      if (!res.ok) throw new Error(`PagerDuty ${action} failed: ${res.status}`)
      return
    }

    throw new Error(`Unknown PagerDuty action: ${action}. Use acknowledge|resolve|note|event`)
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}

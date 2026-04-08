/**
 * Built-in coding skills for HopCoderX.
 *
 * Each skill is a named set of agent tools + context that adds specialized
 * capabilities to the coding agent. Skills are loaded lazily on demand.
 *
 * Available skills:
 *   - github   : GitHub Issues, PRs, Releases, Actions status
 *   - docker   : Container management (build, run, logs, inspect)
 *   - sentry   : Error tracking + stack traces
 *   - vercel   : Deployment status + logs
 *   - datadog  : Metrics + dashboards
 *   - pagerduty: Incident management (via channel)
 *
 * Usage in agent prompt:
 *   "Check GitHub Actions status for my last push"
 *   "Show me the top Sentry errors from today"
 *   "Trigger a Vercel deployment"
 */

export interface SkillTool {
  name: string
  description: string
  execute: (args: Record<string, any>) => Promise<string>
}

export interface Skill {
  id: string
  name: string
  description: string
  requiredEnv: string[]
  tools: SkillTool[]
  isAvailable(): boolean
}

// ─── GitHub Skill ──────────────────────────────────────────────────────────────

const githubSkill: Skill = {
  id: "github",
  name: "GitHub",
  description: "GitHub Issues, PRs, Releases, Actions status, and notifications.",
  requiredEnv: ["GITHUB_TOKEN"],
  isAvailable: () => !!process.env.GITHUB_TOKEN,
  tools: [
    {
      name: "github-actions-status",
      description: "Get GitHub Actions workflow run status for a repository.",
      async execute({ repo, limit = 5 }) {
        const token = process.env.GITHUB_TOKEN
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=${limit}`, {
          headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
        })
        if (!res.ok) return `Error: ${res.status}`
        const data = (await res.json()) as { workflow_runs: any[] }
        return data.workflow_runs.map((r: any) => `${r.name}: ${r.status}/${r.conclusion} (${r.head_branch})`).join("\n")
      },
    },
    {
      name: "github-list-prs",
      description: "List open pull requests in a repository.",
      async execute({ repo, state = "open" }) {
        const token = process.env.GITHUB_TOKEN
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=${state}&per_page=10`, {
          headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
        })
        if (!res.ok) return `Error: ${res.status}`
        const prs = (await res.json()) as any[]
        return prs.map((pr: any) => `#${pr.number} ${pr.title} by ${pr.user.login}`).join("\n")
      },
    },
    {
      name: "github-create-issue",
      description: "Create a new GitHub issue.",
      async execute({ repo, title, body, labels = [] }) {
        const token = process.env.GITHUB_TOKEN
        const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
          method: "POST",
          headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github.v3+json" },
          body: JSON.stringify({ title, body, labels }),
        })
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`
        const issue = (await res.json()) as { number: number; html_url: string }
        return `Issue #${issue.number} created: ${issue.html_url}`
      },
    },
  ],
}

// ─── Docker Skill ──────────────────────────────────────────────────────────────

import { execFile } from "child_process"
import { promisify } from "util"
const execFileAsync = promisify(execFile)

const dockerSkill: Skill = {
  id: "docker",
  name: "Docker",
  description: "Container management: build, run, stop, logs, inspect.",
  requiredEnv: [],
  isAvailable: () => true, // Check at runtime if docker is installed
  tools: [
    {
      name: "docker-ps",
      description: "List running Docker containers.",
      async execute({ all = false }) {
        const args = ["ps", "--format", "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"]
        if (all) args.push("-a")
        try {
          const { stdout } = await execFileAsync("docker", args)
          return stdout || "No containers running."
        } catch {
          return "Docker not available or not running."
        }
      },
    },
    {
      name: "docker-logs",
      description: "Get logs from a container.",
      async execute({ container, tail = 50 }) {
        try {
          const { stdout } = await execFileAsync("docker", ["logs", "--tail", String(tail), container])
          return stdout || "(no output)"
        } catch (e: any) {
          return `Error: ${e.stderr || e.message}`
        }
      },
    },
    {
      name: "docker-images",
      description: "List local Docker images.",
      async execute({}) {
        try {
          const { stdout } = await execFileAsync("docker", ["images", "--format", "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"])
          return stdout || "No images found."
        } catch {
          return "Docker not available."
        }
      },
    },
  ],
}

// ─── Sentry Skill ──────────────────────────────────────────────────────────────

const sentrySkill: Skill = {
  id: "sentry",
  name: "Sentry",
  description: "Error tracking, stack traces, and issue management from Sentry.",
  requiredEnv: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"],
  isAvailable: () => !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG),
  tools: [
    {
      name: "sentry-issues",
      description: "List recent Sentry issues for a project.",
      async execute({ project, limit = 10 }) {
        const org = process.env.SENTRY_ORG
        const token = process.env.SENTRY_AUTH_TOKEN
        const res = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/issues/?limit=${limit}&query=is:unresolved`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return `Error: ${res.status}`
        const issues = (await res.json()) as any[]
        return issues.map((i: any) => `[${i.level}] ${i.title} (×${i.count}) — ${i.lastSeen}`).join("\n")
      },
    },
    {
      name: "sentry-error-detail",
      description: "Get details and stack trace for a specific Sentry issue.",
      async execute({ issueId }) {
        const token = process.env.SENTRY_AUTH_TOKEN
        const res = await fetch(`https://sentry.io/api/0/issues/${issueId}/events/latest/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return `Error: ${res.status}`
        const event = (await res.json()) as any
        const frames = event.entries?.find((e: any) => e.type === "exception")?.data?.values?.[0]?.stacktrace?.frames ?? []
        const trace = frames.slice(-5).map((f: any) => `  ${f.filename}:${f.lineno} in ${f.function}`).join("\n")
        return `${event.title}\n\nStack trace:\n${trace}`
      },
    },
  ],
}

// ─── Vercel Skill ──────────────────────────────────────────────────────────────

const vercelSkill: Skill = {
  id: "vercel",
  name: "Vercel",
  description: "Deployment status, logs, and management for Vercel projects.",
  requiredEnv: ["VERCEL_TOKEN"],
  isAvailable: () => !!process.env.VERCEL_TOKEN,
  tools: [
    {
      name: "vercel-deployments",
      description: "List recent Vercel deployments.",
      async execute({ project, limit = 5 }) {
        const token = process.env.VERCEL_TOKEN
        const params = new URLSearchParams({ limit: String(limit) })
        if (project) params.set("projectId", project)
        const res = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return `Error: ${res.status}`
        const data = (await res.json()) as { deployments: any[] }
        return data.deployments.map((d: any) => `${d.name} ${d.state} ${d.url} (${new Date(d.createdAt).toLocaleString()})`).join("\n")
      },
    },
    {
      name: "vercel-deploy",
      description: "Trigger a new Vercel deployment for a project.",
      async execute({ project, branch = "main" }) {
        const token = process.env.VERCEL_TOKEN
        const res = await fetch(`https://api.vercel.com/v13/deployments`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: project, gitSource: { type: "github", ref: branch } }),
        })
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`
        const data = (await res.json()) as { url: string; id: string }
        return `Deployment triggered: https://${data.url} (ID: ${data.id})`
      },
    },
  ],
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const BUILTIN_SKILLS: Skill[] = [githubSkill, dockerSkill, sentrySkill, vercelSkill]

export const SkillRegistry = {
  _custom: [] as Skill[],

  register(skill: Skill): void {
    this._custom.push(skill)
  },

  all(): Skill[] {
    return [...BUILTIN_SKILLS, ...this._custom]
  },

  available(): Skill[] {
    return this.all().filter((s) => s.isAvailable())
  },

  get(id: string): Skill | undefined {
    return this.all().find((s) => s.id === id)
  },
}

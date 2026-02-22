/**
 * hopcoderx-gitlab
 *
 * Runs HopCoderX as a GitLab CI/CD job triggered by Merge Request comments
 * that mention `@hopcoderx`. Mirrors the GitHub Action at `github/index.ts`.
 *
 * Environment variables required (set as masked CI/CD variables):
 *   HOPCODERX_PROVIDER   – e.g. "anthropic"
 *   HOPCODERX_MODEL      – e.g. "claude-opus-4-5"
 *   ANTHROPIC_API_KEY    – (or whichever provider key)
 *   GITLAB_TOKEN         – Personal/project token with api + write_repository scope
 *   CI_API_V4_URL        – auto-set by GitLab CI
 *   CI_PROJECT_ID        – auto-set by GitLab CI
 *   CI_MERGE_REQUEST_IID – auto-set by GitLab CI
 *   CI_JOB_TOKEN         – auto-set by GitLab CI
 *
 * Usage in .gitlab-ci.yml:
 *   include:
 *     - component: $CI_SERVER_FQDN/your-org/hopcoderx-gitlab/hopcoderx@~latest
 *
 * Or manually add a job:
 *   hopcoderx:
 *     stage: ai
 *     image: node:22-alpine
 *     rules:
 *       - if: $CI_MERGE_REQUEST_IID
 *         when: always
 *     script:
 *       - npx hopcoderx-gitlab
 */

import { execSync, spawnSync } from "child_process"

// ─── GitLab API helpers ───────────────────────────────────────────────────────

const GITLAB_URL = (process.env.CI_API_V4_URL ?? "https://gitlab.com/api/v4").replace(/\/$/, "")
const PROJECT_ID = process.env.CI_PROJECT_ID ?? ""
const TOKEN = process.env.GITLAB_TOKEN ?? process.env.CI_JOB_TOKEN ?? ""
const MR_IID = process.env.CI_MERGE_REQUEST_IID ?? ""

async function glFetch(endpoint: string, method = "GET", body?: object): Promise<any> {
  const res = await fetch(`${GITLAB_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`GitLab API ${method} ${endpoint} → ${res.status}: ${text}`)
  }
  return res.json()
}

async function getMRNotes(): Promise<{ id: number; body: string; author: { username: string } }[]> {
  return glFetch(`/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${MR_IID}/notes`)
}

async function postMRNote(body: string): Promise<void> {
  await glFetch(`/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${MR_IID}/notes`, "POST", { body })
}

async function getMRDetails(): Promise<{ title: string; description: string }> {
  return glFetch(`/projects/${encodeURIComponent(PROJECT_ID)}/merge_requests/${MR_IID}`)
}

// ─── Trigger detection ────────────────────────────────────────────────────────

const TRIGGER_PATTERN = /(@hopcoderx|\/hopcoderx)\b/i

function extractPrompt(notes: { body: string; author: { username: string } }[]): string | undefined {
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i]
    if (!note) continue
    if (TRIGGER_PATTERN.test(note.body)) {
      return note.body.replace(TRIGGER_PATTERN, "").trim()
    }
  }
  return undefined
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (!PROJECT_ID || !MR_IID) {
    console.error("[hopcoderx-gitlab] CI_PROJECT_ID or CI_MERGE_REQUEST_IID not set – skipping")
    return
  }

  const notes = await getMRNotes()
  const prompt = extractPrompt(notes)

  if (!prompt) {
    console.log("[hopcoderx-gitlab] No @hopcoderx mention found in MR notes – nothing to do")
    return
  }

  const mr = await getMRDetails()
  const context = `MR: ${mr.title}\n\n${mr.description ?? ""}\n\nRequest: ${prompt}`

  console.log(`[hopcoderx-gitlab] Running HopCoderX: "${prompt.slice(0, 80)}..."`)

  // Post a "working on it" comment
  await postMRNote(
    `> 🤖 **HopCoderX** is working on your request…\n\n*Prompt:* ${prompt.slice(0, 200)}`,
  )

  let result: string
  try {
    const out = spawnSync(
      "hopcoderx",
      ["run", "--print-logs", context],
      {
        stdio: ["inherit", "pipe", "pipe"],
        encoding: "utf8",
        env: {
          ...process.env,
          HOPCODERX_NON_INTERACTIVE: "1",
        },
        timeout: 10 * 60_000, // 10‑minute timeout
      },
    )
    result = [out.stdout, out.stderr].filter(Boolean).join("\n").trim()
    if (!result) result = out.status === 0 ? "Done ✅" : `Exited with code ${out.status}`
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : String(err)}`
  }

  await postMRNote(`> 🤖 **HopCoderX** finished.\n\n\`\`\`\n${result.slice(0, 3000)}\n\`\`\``)
}

run().catch((err) => {
  console.error("[hopcoderx-gitlab] Fatal:", err)
  process.exit(1)
})

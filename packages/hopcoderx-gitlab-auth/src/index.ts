import type { Plugin, AuthOuathResult } from "@hopcoderx/plugin"
import { GitLabOAuthFlow } from "./oauth-flow.js"
import { generateSecret, generateCodeChallengeFromVerifier } from "./pkce.js"
import { CallbackServer } from "./callback-server.js"
import fs from "fs"
import path from "path"
import os from "os"

// Register your own GitLab OAuth app and set this env var.
// See: https://docs.gitlab.com/ee/integration/oauth_provider.html
const CLIENT_ID =
  process.env.GITLAB_OAUTH_CLIENT_ID ?? "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const GITLAB_COM_URL = "https://gitlab.com"
const OAUTH_SCOPES = ["api"]

function log(message: string, data?: unknown) {
  try {
    const dir = path.join(os.homedir(), ".local", "share", "hopcoderx", "log")
    fs.mkdirSync(dir, { recursive: true })
    const line = data ? `[${new Date().toISOString()}] ${message}: ${JSON.stringify(data)}\n` : `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(path.join(dir, "gitlab-auth.log"), line)
  } catch {
    // ignore
  }
}

function authPath(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return path.join(xdg, "hopcoderx", "auth.json")
  if (process.platform !== "win32") return path.join(os.homedir(), ".local", "share", "hopcoderx", "auth.json")
  return path.join(os.homedir(), ".hopcoderx", "auth.json")
}

function readAuth(): Record<string, any> {
  const p = authPath()
  if (!fs.existsSync(p)) return {}
  return JSON.parse(fs.readFileSync(p, "utf-8"))
}

function writeAuth(data: Record<string, any>) {
  const p = authPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
  fs.chmodSync(p, 0o600)
}

function saveOAuth(access: string, refresh: string, expires: number, enterpriseUrl?: string) {
  const data = readAuth()
  data.gitlab = { type: "oauth", access, refresh, expires, enterpriseUrl }
  writeAuth(data)
}

function savePAT(key: string, enterpriseUrl?: string) {
  const data = readAuth()
  data.gitlab = { type: "api", key, enterpriseUrl }
  writeAuth(data)
}

let refreshInProgress: Promise<void> | null = null

async function refreshIfNeeded(authData: { access: string; refresh: string; expires: number; enterpriseUrl?: string }, auth: () => Promise<any>) {
  const now = Date.now()
  if (authData.expires > now + 5 * 60_000) {
    return { apiKey: authData.access, instanceUrl: authData.enterpriseUrl ?? GITLAB_COM_URL }
  }
  if (refreshInProgress) {
    log("Token refresh in progress, waiting…")
    await refreshInProgress
    const refreshed = await auth()
    if (refreshed?.type === "oauth") return { apiKey: refreshed.access, instanceUrl: refreshed.enterpriseUrl ?? GITLAB_COM_URL }
    throw new Error("Failed to get refreshed auth data")
  }
  log("Token expiring, refreshing…")
  refreshInProgress = (async () => {
    const instanceUrl = authData.enterpriseUrl ?? GITLAB_COM_URL
    const flow = new GitLabOAuthFlow({ instanceUrl, clientId: CLIENT_ID, scopes: OAUTH_SCOPES, method: "auto" })
    const tokens = await flow.exchangeRefreshToken(authData.refresh)
    const newExpiry = Date.now() + tokens.expires_in * 1000
    saveOAuth(tokens.access_token, tokens.refresh_token, newExpiry, instanceUrl)
    log("Token refreshed", { expiresAt: new Date(newExpiry).toISOString() })
  })()
  try {
    await refreshInProgress
  } finally {
    refreshInProgress = null
  }
  const refreshed = await auth()
  if (refreshed?.type === "oauth") return { apiKey: refreshed.access, instanceUrl: refreshed.enterpriseUrl ?? GITLAB_COM_URL }
  throw new Error("Failed to get refreshed auth data after refresh")
}

/**
 * HopCoderX GitLab Auth Plugin
 */
export const gitlabAuthPlugin: Plugin = async () => ({
  auth: {
    provider: "gitlab",
    async loader(auth) {
      const authData = await auth()
      if (!authData) return {}
      if (authData.type === "oauth") {
        try {
          return { ...(await refreshIfNeeded({ access: authData.access, refresh: authData.refresh, expires: authData.expires, enterpriseUrl: authData.enterpriseUrl }, auth)), clientId: CLIENT_ID }
        } catch (err) {
          log("Failed to refresh token in loader", { error: err instanceof Error ? err.message : String(err) })
          return { apiKey: authData.access, instanceUrl: authData.enterpriseUrl ?? GITLAB_COM_URL, clientId: CLIENT_ID }
        }
      }
      if (authData.type === "api" || authData.type === "wellknown") {
        const instanceUrl = process.env.GITLAB_INSTANCE_URL ?? GITLAB_COM_URL
        return { apiKey: authData.key, instanceUrl }
      }
      return {}
    },
    methods: [
      {
        type: "oauth",
        label: "GitLab OAuth",
        prompts: [
          {
            type: "text",
            key: "instanceUrl",
            message: "GitLab instance URL",
            placeholder: "https://gitlab.com",
            validate: (v) => (v ? ((() => { try { new URL(v); return undefined } catch { return "Invalid URL format" } })()) : "Instance URL is required"),
          },
        ],
        async authorize(inputs): Promise<AuthOuathResult> {
          const rawUrl = inputs?.instanceUrl ?? process.env.GITLAB_INSTANCE_URL ?? GITLAB_COM_URL
          let instanceUrl: string
          try {
            const u = new URL(rawUrl)
            instanceUrl = `${u.protocol}//${u.host}`
          } catch {
            throw new Error(`Invalid GitLab instance URL: ${rawUrl}`)
          }
          const codeVerifier = generateSecret(43)
          const codeChallenge = generateCodeChallengeFromVerifier(codeVerifier)
          const state = generateSecret(32)
          const server = new CallbackServer({ port: 0, host: "127.0.0.1", timeout: 120_000 })
          const callbackPromise = server.waitForCallback()
          const redirectUri = server.getCallbackUrl()
          const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: "code",
            state,
            scope: OAUTH_SCOPES.join(" "),
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
          })
          const url = `${instanceUrl}/oauth/authorize?${params}`
          return {
            url,
            instructions: `Opening GitLab (${instanceUrl}) in your browser. Complete the authorization and return here.`,
            method: "auto",
            async callback() {
              try {
                const result = await callbackPromise
                if (result.state !== state) throw new Error("State mismatch — possible CSRF attack")
                const flow = new GitLabOAuthFlow({ instanceUrl, clientId: CLIENT_ID, scopes: OAUTH_SCOPES })
                const tokens = await flow.exchangeAuthorizationCode(result.code, codeVerifier, redirectUri)
                const expires = Date.now() + tokens.expires_in * 1000
                saveOAuth(tokens.access_token, tokens.refresh_token, expires, instanceUrl)
                return { type: "success" as const, provider: "gitlab", refresh: tokens.refresh_token, access: tokens.access_token, expires }
              } catch {
                return { type: "failed" as const }
              } finally {
                await server.close()
              }
            },
          }
        },
      },
      {
        type: "api",
        label: "GitLab Personal Access Token",
        prompts: [
          {
            type: "text",
            key: "key",
            message: "Personal Access Token",
            placeholder: "glpat-...",
            validate: (v) => (v ? undefined : "Token is required"),
          },
          {
            type: "text",
            key: "instanceUrl",
            message: "GitLab instance URL (leave blank for gitlab.com)",
            placeholder: "https://gitlab.com",
          },
        ],
        async authorize(inputs) {
          const key = inputs?.key
          if (!key) return { type: "failed" }
          const enterpriseUrl = inputs?.instanceUrl || undefined
          savePAT(key, enterpriseUrl)
          return { type: "success", key, provider: "gitlab" }
        },
      },
    ],
  },
})

export default gitlabAuthPlugin

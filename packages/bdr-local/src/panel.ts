import { join } from "path"
import { getSession, deleteSession, listSettings, setSetting, listApiKeys, saveApiKey, deleteApiKey, listUsers, updateUser, getUsageToday, getUsageMonth, getAdminUsageStats, PLAN_QUOTA, createUserToken, listUserTokens, deleteUserToken } from "./db"
import { signupEmail, loginEmail, githubAuthUrl, githubCallback } from "./auth"

const PANEL_HTML = join(import.meta.dir, "../public/panel.html")

const CORS_PANEL = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS_PANEL } })
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status)
}

// Extract session token from Authorization header or cookie
function sessionToken(req: Request) {
  const auth = req.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) return auth.slice(7)
  const cookie = req.headers.get("cookie") ?? ""
  return cookie.match(/bdr_session=([^;]+)/)?.[1] ?? null
}

function requireAuth(req: Request) {
  const token = sessionToken(req)
  if (!token) return null
  return getSession(token)
}

function requireAdmin(req: Request) {
  const user = requireAuth(req)
  if (!user || user.role !== "admin") return null
  return user
}

// Derive the public-facing origin — Railway terminates TLS at the proxy, so
// X-Forwarded-Proto / X-Forwarded-Host reflect the real scheme and host.
function reqOrigin(req: Request, url: URL) {
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host
  return `${proto}://${host}`
}

export async function handlePanel(req: Request, path: string): Promise<Response> {
  const { method } = req
  const url = new URL(req.url)

  if (method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_PANEL })

  // Serve panel SPA
  if (!path.startsWith("/panel/api/")) {
    const file = Bun.file(PANEL_HTML)
    if (!(await file.exists())) return new Response("Panel not found", { status: 404 })
    return new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  const api = path.replace("/panel/api", "")

  // --- Auth ---

  if (api === "/auth/signup" && method === "POST") {
    const { email, password } = (await req.json()) as { email: string; password: string }
    const token = await signupEmail(email, password).catch((e: Error) => { throw e })
    return json({ token })
  }

  if (api === "/auth/login" && method === "POST") {
    const { email, password } = (await req.json()) as { email: string; password: string }
    const token = await loginEmail(email, password).catch((e: Error) => { throw e })
    return json({ token })
  }

  if (api === "/auth/logout" && method === "POST") {
    const token = sessionToken(req)
    if (token) deleteSession(token)
    return json({ ok: true })
  }

  if (api === "/auth/github" && method === "GET") {
    const state = Math.random().toString(36).slice(2)
    const origin = reqOrigin(req, url)
    const redirectUri = `${origin}/panel/api/auth/github/callback`
    const redirectUrl = githubAuthUrl(state, redirectUri)
    return Response.redirect(redirectUrl, 302)
  }

  if (api === "/auth/github/callback" && method === "GET") {
    const code = url.searchParams.get("code")
    if (!code) return err("Missing code")
    const origin = reqOrigin(req, url)
    const redirectUri = `${origin}/panel/api/auth/github/callback`
    const token = await githubCallback(code, redirectUri)
    return Response.redirect(`${origin}/panel#token=${token}`, 302)
  }

  // --- Me ---

  if (api === "/me" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    return json(user)
  }

  // --- Settings (admin) ---

  if (api === "/settings" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    return json(listSettings())
  }

  if (api === "/settings" && method === "POST") {
    const user = requireAdmin(req)
    if (!user) return err("Forbidden", 403)
    const body = (await req.json()) as { key: string; value: string }
    if (!body.key) return err("key required")
    setSetting(body.key, body.value ?? "")
    return json({ ok: true })
  }

  // --- API Keys ---

  if (api === "/keys" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    return json(listApiKeys(user.id))
  }

  if (api === "/keys" && method === "POST") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    const body = (await req.json()) as { provider: string; value: string; label?: string }
    if (!body.provider || !body.value) return err("provider and value required")
    const id = saveApiKey(user.id, body.provider, body.value, body.label)
    return json({ id })
  }

  const keyMatch = api.match(/^\/keys\/([^/]+)$/)
  if (keyMatch && method === "DELETE") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    deleteApiKey(keyMatch[1], user.id)
    return json({ ok: true })
  }

  // --- BDR API Tokens ---

  if (api === "/tokens" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    return json(listUserTokens(user.id))
  }

  if (api === "/tokens" && method === "POST") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    const body = (await req.json().catch(() => ({}))) as { label?: string }
    const id = createUserToken(user.id, body.label)
    return json({ id })
  }

  const tokenMatch = api.match(/^\/tokens\/([^/]+)$/)
  if (tokenMatch && method === "DELETE") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    deleteUserToken(tokenMatch[1], user.id)
    return json({ ok: true })
  }

  // --- Usage ---

  if (api === "/usage" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    const quota = PLAN_QUOTA[user.role === "admin" ? "admin" : user.plan] ?? PLAN_QUOTA.free
    const today = getUsageToday(user.id)
    const month = getUsageMonth(user.id)
    return json({ today, month, quota, plan: user.plan, role: user.role })
  }

  if (api === "/usage/admin" && method === "GET") {
    const user = requireAdmin(req)
    if (!user) return err("Forbidden", 403)
    return json(getAdminUsageStats())
  }

  // --- Users (admin) ---

  if (api === "/users" && method === "GET") {
    const user = requireAdmin(req)
    if (!user) return err("Forbidden", 403)
    return json(listUsers())
  }

  const userMatch = api.match(/^\/users\/([^/]+)$/)
  if (userMatch && method === "PATCH") {
    const user = requireAdmin(req)
    if (!user) return err("Forbidden", 403)
    const body = (await req.json()) as { plan?: string; role?: string }
    updateUser(userMatch[1], body)
    return json({ ok: true })
  }

  // --- Gateway health ---

  if (api === "/gateway/health" && method === "GET") {
    const user = requireAuth(req)
    if (!user) return err("Unauthorized", 401)
    const mode = Bun.env.OPENROUTER_API_KEY ? "openrouter" : "portkey"
    const upstream = mode === "openrouter" ? `openrouter/@preset/${Bun.env.OPENROUTER_PRESET ?? "hopcoder-free"}` : (Bun.env.PORTKEY_GATEWAY_URL ?? "https://hopcoderx-bdr.up.railway.app")
    return json({ mode, upstream, portkey_console: "https://hopcoderx-bdr.up.railway.app/public/" })
  }

  return json({ error: "not_found" }, 404)
}

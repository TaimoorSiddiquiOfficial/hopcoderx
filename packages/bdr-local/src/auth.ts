import { createUser, createSession, getUserByEmail, getUserByGithub } from "./db"

const GITHUB_CLIENT_ID = Bun.env.GITHUB_CLIENT_ID ?? ""
const GITHUB_CLIENT_SECRET = Bun.env.GITHUB_CLIENT_SECRET ?? ""

// --- Email auth ---

export async function signupEmail(email: string, pw: string) {
  if (!email || !pw) throw new Error("Email and password required")
  if (pw.length < 8) throw new Error("Password must be at least 8 characters")
  if (getUserByEmail(email)) throw new Error("Email already registered")
  const hash = await Bun.password.hash(pw)
  const user = createUser({ email, password_hash: hash })
  return createSession(user.id)
}

export async function loginEmail(email: string, pw: string) {
  const user = getUserByEmail(email)
  if (!user || !user.password_hash) throw new Error("Invalid credentials")
  const ok = await Bun.password.verify(pw, user.password_hash)
  if (!ok) throw new Error("Invalid credentials")
  return createSession(user.id)
}

// --- GitHub OAuth ---

export function githubAuthUrl(state: string) {
  if (!GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID not set")
  const params = new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "user:email", state })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function githubCallback(code: string): Promise<string> {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) throw new Error("GitHub OAuth not configured")

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
  })
  const { access_token, error_description } = (await tokenRes.json()) as { access_token?: string; error_description?: string }
  if (!access_token) throw new Error(error_description ?? "GitHub auth failed")

  const profile = (await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "HopCoderX-BDR" },
  }).then((r) => r.json())) as { id: number; login: string; avatar_url: string; email: string | null }

  // Fetch primary email if not public
  let email = profile.email
  if (!email) {
    const emails = (await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "HopCoderX-BDR" },
    }).then((r) => r.json())) as { email: string; primary: boolean; verified: boolean }[]
    email = emails.find((e) => e.primary && e.verified)?.email ?? null
  }

  const existing = getUserByGithub(String(profile.id))
  const user = existing ?? createUser({ github_id: String(profile.id), github_login: profile.login, avatar_url: profile.avatar_url, email: email ?? undefined })
  return createSession(user.id)
}

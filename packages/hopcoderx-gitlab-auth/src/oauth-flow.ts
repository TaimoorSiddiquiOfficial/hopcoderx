type OAuthFlowOptions = {
  instanceUrl: string
  clientId: string
  scopes: string[]
  method?: "auto" | "manual"
  timeout?: number
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

export class GitLabOAuthFlow {
  constructor(private options: OAuthFlowOptions) {}

  async exchangeAuthorizationCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenResponse> {
    const tokenUrl = `${this.options.instanceUrl.replace(/\/$/, "")}/oauth/token`
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${res.statusText} — ${await res.text()}`)
    return res.json() as Promise<TokenResponse>
  }

  async exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
    const tokenUrl = `${this.options.instanceUrl.replace(/\/$/, "")}/oauth/token`
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${res.statusText} — ${await res.text()}`)
    return res.json() as Promise<TokenResponse>
  }
}

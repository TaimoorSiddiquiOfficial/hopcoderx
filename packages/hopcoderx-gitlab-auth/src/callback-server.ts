import http from "http"
import { URL } from "url"

type CallbackResult = { code: string; state: string }

type CallbackServerOptions = {
  port?: number
  host?: string
  timeout?: number
}

export class CallbackServer {
  private server: http.Server
  private resolveCallback?: (result: CallbackResult) => void
  private rejectCallback?: (err: Error) => void
  private timeoutHandle?: ReturnType<typeof setTimeout>
  private options: CallbackServerOptions

  constructor(options: CallbackServerOptions = {}) {
    this.options = options
    this.server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`)
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404)
        res.end("Not found")
        return
      }

      const code = reqUrl.searchParams.get("code")
      const state = reqUrl.searchParams.get("state")
      const error = reqUrl.searchParams.get("error")
      const errorDesc = reqUrl.searchParams.get("error_description")

      const html = (title: string, body: string) =>
        `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p><p>You can close this window.</p></body></html>`

      if (error) {
        const msg = errorDesc ?? error
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(html("Authentication Failed", msg))
        this.rejectCallback?.(new Error(`OAuth error: ${msg}`))
        this.cleanup()
        return
      }

      if (!code || !state) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(html("Authentication Failed", "Missing required parameters."))
        this.rejectCallback?.(new Error("Missing code or state parameter"))
        this.cleanup()
        return
      }

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(html("Authentication Successful", "You can close this window and return to your terminal."))
      this.resolveCallback?.({ code, state })
      this.cleanup()
    })
  }

  async waitForCallback(): Promise<CallbackResult> {
    const timeout = this.options.timeout ?? 60_000
    const host = this.options.host ?? "127.0.0.1"
    const port = this.options.port ?? 0

    await new Promise<void>((resolve, reject) => {
      this.server.listen({ host, port }, () => resolve())
      this.server.on("error", reject)
    })

    this.timeoutHandle = setTimeout(() => {
      this.rejectCallback?.(new Error("OAuth callback timeout"))
      this.cleanup()
    }, timeout)

    return new Promise<CallbackResult>((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject
    })
  }

  getPort(): number {
    const address = this.server.address()
    if (!address || typeof address === "string") throw new Error("Server not started")
    return address.port
  }

  getCallbackUrl(): string {
    return `http://${this.options.host ?? "127.0.0.1"}:${this.getPort()}/callback`
  }

  private cleanup() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle)
    setTimeout(() => this.server.close(), 100)
  }

  async close() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle)
    return new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

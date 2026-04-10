/**
 * IRC channel for HopCoderX.
 *
 * Full IRC client with TLS, SASL auth, multi-channel support.
 * Uses Bun's native TCP sockets for zero-dependency IRC.
 *
 * Setup:
 *   IRC_SERVER=irc.libera.chat
 *   IRC_PORT=6697               (6697 for TLS, 6667 for plain)
 *   IRC_NICK=hopcoderx-bot
 *   IRC_REALNAME=HopCoderX Bot
 *   IRC_CHANNELS=#hopdev,#code  (comma-separated channels to join)
 *   IRC_SASL_USER=your-nick     (optional SASL PLAIN auth)
 *   IRC_SASL_PASS=your-password
 *   IRC_PREFIX=!hop             (command prefix, default: !hop)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"
import tls from "tls"
import net from "net"

type Handler = (msg: ChannelMessage) => Promise<void>

export class IRCChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "irc",
    name: "IRC",
    envVars: ["IRC_SERVER", "IRC_NICK"],
    canReceive: true,
    canSend: true,
  }

  private server = process.env.IRC_SERVER ?? ""
  private port = parseInt(process.env.IRC_PORT ?? "6697", 10)
  private nick = process.env.IRC_NICK ?? "hopcoderx-bot"
  private realname = process.env.IRC_REALNAME ?? "HopCoderX Bot"
  private channels = (process.env.IRC_CHANNELS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  private saslUser = process.env.IRC_SASL_USER ?? ""
  private saslPass = process.env.IRC_SASL_PASS ?? ""
  private prefix = process.env.IRC_PREFIX ?? "!hop"
  private handlers: Handler[] = []
  private socket: tls.TLSSocket | net.Socket | null = null
  private buffer = ""
  private useTLS = this.port === 6697 || this.port === 7000

  isAvailable(): boolean {
    return !!(this.server && this.nick)
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.socket) throw new Error("IRC not connected. Call startListening() first.")
    const lines = reply.text.split("\n")
    for (const line of lines) {
      this.write(`PRIVMSG ${to} :${line}`)
    }
  }

  async startListening(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        // SASL authentication
        if (this.saslUser && this.saslPass) {
          this.write("CAP REQ :sasl")
        }
        this.write(`NICK ${this.nick}`)
        this.write(`USER ${this.nick} 0 * :${this.realname}`)
      }

      let sock: tls.TLSSocket | net.Socket
      if (this.useTLS) {
        sock = tls.connect({ host: this.server, port: this.port, rejectUnauthorized: false }, onConnect)
      } else {
        sock = net.connect({ host: this.server, port: this.port })
        sock.on("connect", onConnect)
      }
      this.socket = sock

      sock.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8")
        const lines = this.buffer.split("\r\n")
        this.buffer = lines.pop() ?? ""
        for (const line of lines) {
          this.handleLine(line, resolve)
        }
      })

      sock.on("error", (err) => reject(err))
    })
  }

  async stopListening(): Promise<void> {
    if (this.socket) {
      this.write("QUIT :HopCoderX signing off")
      this.socket.destroy()
      this.socket = null
    }
  }

  private write(line: string): void {
    this.socket?.write(line + "\r\n", "utf8")
  }

  private handleLine(line: string, resolve: () => void): void {
    // Handle PING
    if (line.startsWith("PING ")) {
      this.write("PONG " + line.slice(5))
      return
    }

    // Parse IRC message: [:prefix] command [params] [:trailing]
    const match = line.match(/^(?::([^ ]+) )?([A-Z0-9]+)(.*)?$/)
    if (!match) return
    const [, prefix, command, rest] = match
    const params = rest ? rest.trim().split(" :")[0].trim().split(" ").filter(Boolean) : []
    const trailing = rest?.includes(" :") ? rest.slice(rest.indexOf(" :") + 2) : undefined

    switch (command) {
      case "001": // Welcome — join channels
        for (const ch of this.channels) this.write(`JOIN ${ch}`)
        resolve()
        break

      case "CAP":
        if (trailing === "sasl") {
          this.write("AUTHENTICATE PLAIN")
        }
        break

      case "AUTHENTICATE":
        if (rest?.trim() === "+") {
          const cred = Buffer.from(`${this.saslUser}\0${this.saslUser}\0${this.saslPass}`).toString("base64")
          this.write(`AUTHENTICATE ${cred}`)
        }
        break

      case "903": // SASL success
        this.write("CAP END")
        break

      case "904": // SASL failure
        this.write("CAP END")
        break

      case "PRIVMSG": {
        const target = params[0] ?? ""
        const text = trailing ?? ""
        const nickFromPrefix = prefix?.split("!")[0] ?? "unknown"
        if (nickFromPrefix === this.nick) break

        // Only handle messages with prefix or direct messages
        const isDM = !target.startsWith("#")
        const hasPrefix = text.startsWith(this.prefix)
        if (!isDM && !hasPrefix) break

        const cleanText = hasPrefix ? text.slice(this.prefix.length).trim() : text
        const replyTarget = isDM ? nickFromPrefix : target

        const msg: ChannelMessage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channelId: "irc",
          threadId: replyTarget,
          from: nickFromPrefix,
          text: cleanText,
          timestamp: Date.now(),
          raw: { target, prefix, trailing },
        }

        for (const handler of this.handlers) {
          handler(msg).catch(console.error)
        }
        break
      }
    }
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}

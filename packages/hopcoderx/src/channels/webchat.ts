/**
 * WebChatChannel — browser-based WebSocket chat channel for HopCoderX.
 *
 * Each browser tab that connects gets a unique session ID (UUID).
 * Inbound WS messages are dispatched to the registered onMessage handler.
 * send(sessionId, reply) pushes JSON to the matching socket.
 *
 * The Hono WebSocket route at /chat/ws must be registered separately:
 *   see src/server/routes/chat.ts
 *
 * No env vars required — always available.
 */

import { randomUUID } from "crypto"
import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

export interface WebChatSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly readyState: number
}

export interface WebChatSession {
  id: string
  socket: WebChatSocket
  connectedAt: number
}

type MessageHandler = (msg: ChannelMessage) => Promise<void>

// Singleton registry of active sessions — exported so the Hono route can call in
export const WebChatSessions = new Map<string, WebChatSession>()

let _messageHandler: MessageHandler | null = null

/** Called by the Hono route when a new WebSocket connection opens. Returns session ID. */
export function webchatOnOpen(socket: WebChatSocket): string {
  const id = randomUUID()
  WebChatSessions.set(id, { id, socket, connectedAt: Date.now() })
  // Send a welcome handshake so the client knows its session ID
  try {
    socket.send(JSON.stringify({ type: "connected", sessionId: id }))
  } catch {}
  return id
}

/** Called by the Hono route when a WebSocket message arrives. */
export async function webchatOnMessage(sessionId: string, data: string): Promise<void> {
  const session = WebChatSessions.get(sessionId)
  if (!session || !_messageHandler) return
  let text: string
  try {
    const parsed = JSON.parse(data) as { text?: string; content?: string }
    text = parsed.text ?? parsed.content ?? data
  } catch {
    text = data
  }
  await _messageHandler({
    id: randomUUID(),
    channelId: "webchat",
    from: sessionId,
    text,
    timestamp: Date.now(),
    raw: { sessionId },
  })
}

/** Called by the Hono route when a WebSocket connection closes. */
export function webchatOnClose(sessionId: string): void {
  WebChatSessions.delete(sessionId)
}

// ─── WebChatChannel ────────────────────────────────────────────────────────────

export class WebChatChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "webchat",
    name: "WebChat (Browser)",
    envVars: [],
    canReceive: true,
    canSend: true,
  }

  async init(): Promise<void> {}

  isAvailable(): boolean {
    return true
  }

  onMessage(handler: MessageHandler): void {
    _messageHandler = handler
  }

  async startListening(): Promise<void> {
    // WebSocket upgrades are handled by the Hono route; nothing to do here
  }

  async stopListening(): Promise<void> {
    for (const [id, session] of WebChatSessions) {
      try { session.socket.close(1001, "Server shutting down") } catch {}
      WebChatSessions.delete(id)
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    const session = WebChatSessions.get(to)
    if (!session) return
    const payload = JSON.stringify({
      type: "message",
      text: reply.text,
      ...(reply.threadId ? { threadId: reply.threadId } : {}),
      ...(reply.attachments?.length ? { attachments: reply.attachments } : {}),
    })
    try {
      session.socket.send(payload)
    } catch {
      WebChatSessions.delete(to)
    }
  }

  async sendTyping(to: string): Promise<void> {
    const session = WebChatSessions.get(to)
    if (!session) return
    try {
      session.socket.send(JSON.stringify({ type: "typing" }))
    } catch {}
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const activeSessions = WebChatSessions.size
    return {
      channelId: "webchat",
      ok: true,
      summary: `WebSocket ready — ${activeSessions} session(s) connected`,
      checks: [
        { name: "Channel available", ok: true },
        { name: "Active sessions", ok: true, detail: `${activeSessions}` },
        { name: "Message handler", ok: _messageHandler !== null, detail: _messageHandler ? "registered" : "none" },
      ],
    }
  }
}

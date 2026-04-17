/**
 * /chat WebSocket routes
 *
 * GET /chat/ws   — upgrade to WebSocket for browser chat
 * GET /chat/sessions — list active session IDs (dev/debug)
 */

import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { webchatOnOpen, webchatOnMessage, webchatOnClose } from "../../channels/webchat"

export const ChatRoutes = lazy(() =>
  new Hono()
    .get("/sessions", (c) => {
      const { WebChatSessions } = require("../../channels/webchat") as typeof import("../../channels/webchat")
      const sessions = [...WebChatSessions.values()].map((s) => ({
        id: s.id,
        connectedAt: s.connectedAt,
      }))
      return c.json({ count: sessions.length, sessions })
    })
    .get(
      "/ws",
      upgradeWebSocket(() => {
        let sessionId: string | null = null

        return {
          onOpen(_event, ws) {
            const raw = ws.raw as { send?: (d: string) => void; close?: (code?: number, reason?: string) => void; readyState?: number } | null
            if (!raw || typeof raw.send !== "function") {
              ws.close()
              return
            }
            sessionId = webchatOnOpen({
              send: (d) => raw.send!(d),
              close: (code, reason) => raw.close?.(code, reason),
              get readyState() { return raw.readyState ?? 0 },
            })
          },
          onMessage(event) {
            if (!sessionId) return
            const data = typeof event.data === "string" ? event.data : String(event.data)
            webchatOnMessage(sessionId, data).catch((e: unknown) => {
              const log = Log.create({ service: "chat.ws" })
              log.warn("webchat message handling failed", { sessionId, error: e })
            })
          },
          onClose() {
            if (sessionId) webchatOnClose(sessionId)
            sessionId = null
          },
          onError() {
            if (sessionId) webchatOnClose(sessionId)
            sessionId = null
          },
        }
      }),
    ),
)

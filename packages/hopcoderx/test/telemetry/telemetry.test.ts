import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Telemetry } from "../../src/telemetry/telemetry"

describe("Telemetry", () => {
  // Always start each test with a clean slate
  beforeEach(() => Telemetry.flush())
  afterEach(() => Telemetry.flush())

  // ─── Spans ────────────────────────────────────────────────────────────────

  describe("startSpan", () => {
    test("records a completed span", () => {
      const span = Telemetry.startSpan("test.op", { model: "gpt-4" })
      span.end()
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans.length).toBe(1)
      expect(recentSpans[0].name).toBe("test.op")
      expect(recentSpans[0].attributes.model).toBe("gpt-4")
      expect(recentSpans[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    test("records span error", () => {
      const span = Telemetry.startSpan("fail.op")
      span.end("timeout exceeded")
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans[0].error).toBe("timeout exceeded")
    })

    test("setAttribute updates span attributes after start", () => {
      const span = Telemetry.startSpan("attr.op")
      span.setAttribute("count", 42)
      span.end()
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans[0].attributes.count).toBe(42)
    })

    test("unended span has no durationMs", () => {
      Telemetry.startSpan("open.op")
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans[0].durationMs).toBeUndefined()
    })

    test("caps at MAX_SPANS (1000) via FIFO eviction", () => {
      for (let i = 0; i < 1010; i++) {
        const s = Telemetry.startSpan(`op.${i}`)
        s.end()
      }
      // metrics() returns last 50, but recentSpans internal buffer should be <= 1000
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans.length).toBeLessThanOrEqual(50)
      // The oldest spans (0-9) should have been evicted
      expect(recentSpans.every((s) => !s.name.startsWith("op.0"))).toBe(true)
    })
  })

  // ─── Tool telemetry ───────────────────────────────────────────────────────

  describe("recordToolCall", () => {
    test("tracks calls, totalMs, and avgMs", () => {
      Telemetry.recordToolCall("bash", 100)
      Telemetry.recordToolCall("bash", 200)
      const { tools } = Telemetry.metrics()
      expect(tools["bash"].calls).toBe(2)
      expect(tools["bash"].totalMs).toBe(300)
      expect(tools["bash"].avgMs).toBe(150)
    })

    test("tracks errors and errorRate", () => {
      Telemetry.recordToolCall("read", 50)
      Telemetry.recordToolCall("read", 50, "file not found")
      const { tools } = Telemetry.metrics()
      expect(tools["read"].errors).toBe(1)
      expect(tools["read"].errorRate).toBeCloseTo(0.5)
    })

    test("errorRate is 0 when there are no errors", () => {
      Telemetry.recordToolCall("glob", 10)
      const { tools } = Telemetry.metrics()
      expect(tools["glob"].errorRate).toBe(0)
    })

    test("tracks multiple tools independently", () => {
      Telemetry.recordToolCall("edit", 200)
      Telemetry.recordToolCall("write", 50)
      const { tools } = Telemetry.metrics()
      expect(tools["edit"].calls).toBe(1)
      expect(tools["write"].calls).toBe(1)
    })
  })

  // ─── Session telemetry ────────────────────────────────────────────────────

  describe("sessionStart / sessionStep / sessionEnd", () => {
    test("registers a session", () => {
      Telemetry.sessionStart("sess-1")
      const { sessions } = Telemetry.metrics()
      expect(sessions.some((s) => s.sessionID === "sess-1")).toBe(true)
    })

    test("increments steps", () => {
      Telemetry.sessionStart("sess-2")
      Telemetry.sessionStep("sess-2")
      Telemetry.sessionStep("sess-2")
      const { sessions } = Telemetry.metrics()
      const s = sessions.find((x) => x.sessionID === "sess-2")!
      expect(s.steps).toBe(2)
    })

    test("tracks tool calls within a session", () => {
      Telemetry.sessionStart("sess-3")
      Telemetry.sessionToolCall("sess-3")
      Telemetry.sessionToolCall("sess-3", "err")
      const { sessions } = Telemetry.metrics()
      const s = sessions.find((x) => x.sessionID === "sess-3")!
      expect(s.toolCalls).toBe(2)
      expect(s.errors).toBe(1)
    })

    test("removes session on end", () => {
      Telemetry.sessionStart("sess-4")
      Telemetry.sessionEnd("sess-4")
      const { sessions } = Telemetry.metrics()
      expect(sessions.some((s) => s.sessionID === "sess-4")).toBe(false)
    })

    test("sessionStep and sessionToolCall on unknown session is a no-op", () => {
      // Should not throw
      expect(() => {
        Telemetry.sessionStep("nonexistent")
        Telemetry.sessionToolCall("nonexistent")
      }).not.toThrow()
    })
  })

  // ─── flush ────────────────────────────────────────────────────────────────

  describe("flush", () => {
    test("clears spans, tools, and sessions", () => {
      const span = Telemetry.startSpan("pre.flush")
      span.end()
      Telemetry.recordToolCall("bash", 100)
      Telemetry.sessionStart("sess-flush")

      Telemetry.flush()

      const { tools, sessions, recentSpans } = Telemetry.metrics()
      expect(recentSpans.length).toBe(0)
      expect(Object.keys(tools).length).toBe(0)
      expect(sessions.length).toBe(0)
    })
  })

  // ─── metrics shape ────────────────────────────────────────────────────────

  describe("metrics", () => {
    test("returns recentSpans as last 50 at most", () => {
      for (let i = 0; i < 60; i++) {
        const s = Telemetry.startSpan(`op.${i}`)
        s.end()
      }
      const { recentSpans } = Telemetry.metrics()
      expect(recentSpans.length).toBe(50)
    })

    test("returns empty snapshot when nothing recorded", () => {
      const { tools, sessions, recentSpans } = Telemetry.metrics()
      expect(Object.keys(tools).length).toBe(0)
      expect(sessions.length).toBe(0)
      expect(recentSpans.length).toBe(0)
    })
  })
})

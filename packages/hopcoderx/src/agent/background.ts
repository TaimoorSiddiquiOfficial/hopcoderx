/**
 * Background Agents for HopCoderX
 *
 * Provides Claude Code-style async delegation with:
 * - File change triggers (watch patterns)
 * - Schedule triggers (cron-like)
 * - Event triggers (session start/end, etc.)
 * - Manual triggers
 * - Persistent context across agent runs
 * - Status tracking and delegation
 *
 * Inspired by:
 * - opencode-background-agents (async delegation)
 * - opencode-workspace (multi-agent orchestration)
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { Agent } from "./agent"
import { Session } from "../session"
import { Config } from "../config/config"
import z from "zod"
import { FileWatcher } from "../file/watcher"
import { minimatch } from "minimatch"
import { Bus } from "../bus"
import { BusEvent } from "@/bus/bus-event"
import { Cron } from "croner"

const log = Log.create({ service: "background-agent" })

/**
 * Background agent configuration
 */
export interface BackgroundAgent {
  id: string
  name: string
  description?: string
  trigger: BackgroundAgentTrigger
  context: string[] // Context files to load
  delegate: string // Agent to delegate to
  persistContext: boolean
  enabled: boolean
}

export type BackgroundAgentTrigger =
  | {
      type: "file_change"
      patterns: string[] // Glob patterns to watch
      debounceMs?: number
    }
  | {
      type: "schedule"
      cron: string // Simple cron: "*/5 * * * *"
      timezone?: string
    }
  | {
      type: "event"
      events: string[] // Event types to listen for
    }
  | {
      type: "manual"
    }

/**
 * Background agent execution status
 */
export interface BackgroundAgentStatus {
  agentID: string
  lastRun: number | null
  nextRun: number | null
  running: boolean
  lastError: string | null
  runCount: number
  successCount: number
  sessionID: string | null // Current/last session
}

/**
 * Background agent execution result
 */
export interface BackgroundAgentResult {
  sessionID: string
  success: boolean
  error?: string
  duration: number
  timestamp: number
}

const DEFAULT_DEBOUNCE_MS = 1000

const state = Instance.state(() => {
  const agents: Map<string, BackgroundAgent> = new Map()
  const statuses: Map<string, BackgroundAgentStatus> = new Map()
  const fileWatchers: Map<string, () => void> = new Map() // Cleanup functions
  const scheduledTimers: Map<string, NodeJS.Timeout> = new Map()

  return {
    agents,
    statuses,
    fileWatchers,
    scheduledTimers,
  }
})

export namespace BackgroundAgentManager {
  /**
   * Initialize background agent system
   */
  export async function init(): Promise<void> {
    const s = await state()
    const cfg = await Config.get()

    // Load agents from config
    const configAgents = cfg.experimental?.background_agents?.enabled ? [] : []
    for (const agentConfig of configAgents) {
      await register(agentConfig)
    }

    log.info("background agent system initialized", {
      agentCount: s.agents.size,
    })
  }

  /**
   * Register a new background agent
   */
  export async function register(agent: BackgroundAgent): Promise<void> {
    const s = await state()

    if (s.agents.has(agent.id)) {
      log.warn("background agent already registered, updating", { id: agent.id })
      await unregister(agent.id)
    }

    s.agents.set(agent.id, agent)

    // Initialize status
    const status: BackgroundAgentStatus = {
      agentID: agent.id,
      lastRun: null,
      nextRun: null,
      running: false,
      lastError: null,
      runCount: 0,
      successCount: 0,
      sessionID: null,
    }
    s.statuses.set(agent.id, status)

    // Set up trigger
    await setupTrigger(agent)

    log.info("background agent registered", {
      id: agent.id,
      trigger: agent.trigger.type,
    })
  }

  /**
   * Unregister a background agent
   */
  export async function unregister(agentID: string): Promise<void> {
    const s = await state()
    const agent = s.agents.get(agentID)

    if (!agent) {
      log.warn("background agent not found", { id: agentID })
      return
    }

    // Cleanup trigger
    await cleanupTrigger(agentID)

    s.agents.delete(agentID)
    s.statuses.delete(agentID)

    log.info("background agent unregistered", { id: agentID })
  }

  /**
   * Spawn a background agent execution
   */
  export async function spawn(agent: BackgroundAgent, context?: { query?: string; files?: string[] }): Promise<BackgroundAgentResult> {
    const s = await state()
    const status = s.statuses.get(agent.id)

    if (!status) {
      throw new Error(`Background agent not found: ${agent.id}`)
    }

    if (status.running) {
      throw new Error(`Background agent already running: ${agent.id}`)
    }

    status.running = true
    status.lastRun = Date.now()

    const start = Date.now()
    let sessionID: string | null = null
    let success = false
    let error: string | undefined

    try {
      // Create a new session for this agent execution
      sessionID = Identifier.descending("session")

      // Load context files if specified
      const contextFiles: string[] = []
      for (const pattern of agent.context) {
        // Context loading would happen here
        // For now, just log it
        log.debug("loading context", { pattern })
      }

      // Build the prompt based on trigger type
      let prompt: string
      if (context?.query) {
        prompt = `Background task triggered: ${context.query}`
      } else if (agent.trigger.type === "file_change") {
        prompt = `Background task triggered by file change. Context files: ${context?.files?.join(", ") || "none"}`
      } else if (agent.trigger.type === "schedule") {
        prompt = `Scheduled background task execution.`
      } else if (agent.trigger.type === "event") {
        prompt = `Event-triggered background task.`
      } else {
        prompt = `Manual background task execution.`
      }

      // Delegate to the specified agent
      const { AgentDelegation } = await import("./delegate")
      await AgentDelegation.delegate({
        sessionID,
        targetAgent: agent.delegate,
        prompt,
        persistContext: agent.persistContext,
      })

      success = true
      status.successCount++
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      status.lastError = error
      log.error("background agent execution failed", {
        agentID: agent.id,
        error,
      })
    } finally {
      status.running = false
      status.sessionID = sessionID
      status.runCount++

      const duration = Date.now() - start

      // Publish result event
      Bus.publish(Event.Executed, {
        agentID: agent.id,
        result: {
          sessionID: sessionID!,
          success,
          error,
          duration,
          timestamp: Date.now(),
        },
      })

      log.info("background agent execution completed", {
        agentID: agent.id,
        success,
        duration,
      })
    }

    return {
      sessionID: sessionID!,
      success,
      error,
      duration: Date.now() - start,
      timestamp: Date.now(),
    }
  }

  /**
   * Get agent status
   */
  export async function getStatus(agentID: string): Promise<BackgroundAgentStatus | undefined> {
    const s = await state()
    return s.statuses.get(agentID)
  }

  /**
   * List all registered agents
   */
  export async function list(): Promise<BackgroundAgent[]> {
    const s = await state()
    return Array.from(s.agents.values())
  }

  /**
   * Enable an agent
   */
  export async function enable(agentID: string): Promise<void> {
    const s = await state()
    const agent = s.agents.get(agentID)

    if (!agent) {
      throw new Error(`Background agent not found: ${agentID}`)
    }

    agent.enabled = true
    await setupTrigger(agent)

    log.info("background agent enabled", { id: agentID })
  }

  /**
   * Disable an agent
   */
  export async function disable(agentID: string): Promise<void> {
    const s = await state()
    const agent = s.agents.get(agentID)

    if (!agent) {
      throw new Error(`Background agent not found: ${agentID}`)
    }

    agent.enabled = false
    await cleanupTrigger(agentID)

    log.info("background agent disabled", { id: agentID })
  }

  async function setupTrigger(agent: BackgroundAgent): Promise<void> {
    if (!agent.enabled) return

    const s = await state()

    switch (agent.trigger.type) {
      case "file_change":
        await setupFileTrigger(agent)
        break
      case "schedule":
        await setupScheduleTrigger(agent)
        break
      case "event":
        await setupEventTrigger(agent)
        break
      case "manual":
        // No automatic trigger setup needed
        break
    }
  }

  async function cleanupTrigger(agentID: string): Promise<void> {
    const s = await state()

    // Cleanup file watcher
    const cleanup = s.fileWatchers.get(agentID)
    if (cleanup) {
      cleanup()
      s.fileWatchers.delete(agentID)
    }

    // Cleanup scheduled timer (now a Cron task with stop method)
    const timer = s.scheduledTimers.get(agentID)
    if (timer) {
      if (typeof (timer as any).stop === "function") {
        ;(timer as any).stop()
      } else {
        clearInterval(timer)
      }
      s.scheduledTimers.delete(agentID)
    }
  }

  async function setupFileTrigger(agent: BackgroundAgent): Promise<void> {
    const s = await state()
    const trigger = agent.trigger as Extract<BackgroundAgentTrigger, { type: "file_change" }>
    const debounceMs = trigger.debounceMs ?? DEFAULT_DEBOUNCE_MS

    // Cleanup existing watcher
    const existingCleanup = s.fileWatchers.get(agent.id)
    if (existingCleanup) {
      existingCleanup()
    }

    let debounceTimer: NodeJS.Timeout | null = null
    const changedFiles = new Set<string>()

    // Subscribe to file watcher events
    const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (event) => {
      const file = event.properties.file
      // Check if file matches any of the patterns
      const matches = trigger.patterns.some((pattern) => {
        return minimatch(file, pattern)
      })

      if (!matches) return

      changedFiles.add(file)

      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(async () => {
        const files = Array.from(changedFiles)
        changedFiles.clear()

        log.info("file change trigger fired", {
          agentID: agent.id,
          files: files.slice(0, 10), // Limit log output
        })

        await spawn(agent, { files })
      }, debounceMs)
    })

    s.fileWatchers.set(agent.id, unsubscribe)

    log.debug("file watcher setup", {
      agentID: agent.id,
      patterns: trigger.patterns,
    })
  }

  async function setupScheduleTrigger(agent: BackgroundAgent): Promise<void> {
    const s = await state()
    const trigger = agent.trigger as Extract<BackgroundAgentTrigger, { type: "schedule" }>

    // Cleanup existing timer
    const existingTimer = s.scheduledTimers.get(agent.id)
    if (existingTimer) {
      clearInterval(existingTimer)
      s.scheduledTimers.delete(agent.id)
    }

    try {
      // Use croner for full cron expression support
      // Supports: standard cron (* * * * *), with seconds (* * * * * *), presets (@hourly, @daily, etc.)
      const cronOptions = trigger.timezone ? { timezone: trigger.timezone } : undefined
      const scheduledTask = Cron(trigger.cron, cronOptions, async () => {
        log.info("schedule trigger fired", { agentID: agent.id })
        await spawn(agent)
      })

      // Store cleanup function
      s.scheduledTimers.set(agent.id, {
        stop: () => scheduledTask.stop(),
      } as any)

      // Calculate next run time
      const status = s.statuses.get(agent.id)
      if (status && scheduledTask.nextRun()) {
        status.nextRun = scheduledTask.nextRun()!.getTime()
      }

      log.debug("schedule trigger setup", {
        agentID: agent.id,
        cron: trigger.cron,
        timezone: trigger.timezone ?? "default",
        nextRun: scheduledTask.nextRun()?.toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("schedule trigger setup failed", {
        agentID: agent.id,
        cron: trigger.cron,
        error: message,
      })
      throw new Error(`Invalid cron expression "${trigger.cron}": ${message}`)
    }
  }

  async function setupEventTrigger(agent: BackgroundAgent): Promise<void> {
    const trigger = agent.trigger as Extract<BackgroundAgentTrigger, { type: "event" }>

    // Subscribe to events
    const unsubscribe = Bus.subscribeAll((event) => {
      if (trigger.events.includes(event.type)) {
        log.info("event trigger fired", {
          agentID: agent.id,
          eventType: event.type,
        })
        spawn(agent, {
          query: `Triggered by event: ${event.type}`,
        }).catch((err) => {
          log.error("event-triggered agent failed", {
            agentID: agent.id,
            error: err,
          })
        })
      }
    })

    const s = await state()
    s.fileWatchers.set(agent.id, unsubscribe)

    log.debug("event trigger setup", {
      agentID: agent.id,
      events: trigger.events,
    })
  }
}

export const Event = {
  Executed: BusEvent.define(
    "background_agent.executed",
    z.object({
      agentID: z.string(),
      result: z.object({
        sessionID: z.string(),
        success: z.boolean(),
        error: z.string().optional(),
        duration: z.number(),
        timestamp: z.number(),
      }),
    }),
  ),
}

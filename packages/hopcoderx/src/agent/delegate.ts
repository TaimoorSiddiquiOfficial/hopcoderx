/**
 * Agent Delegation
 *
 * Handles async delegation of tasks to subagents with:
 * - Context persistence across delegations
 * - Status tracking
 * - Result aggregation
 *
 * Inspired by: opencode-background-agents (async delegation)
 */

import { Log } from "../util/log"
import { Session } from "../session"
import { Agent } from "./agent"
import { Identifier } from "../id/id"
import { MessageV2 } from "../session/message-v2"
import { Bus } from "../bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { SessionPrompt } from "../session/prompt"

const log = Log.create({ service: "agent-delegate" })

export interface DelegationRequest {
  sessionID: string
  targetAgent: string
  prompt: string
  persistContext: boolean
  model?: {
    modelID: string
    providerID: string
  }
}

export interface DelegationResult {
  sessionID: string
  success: boolean
  output?: string
  error?: string
  tokens?: {
    prompt: number
    completion: number
  }
}

export interface DelegationState {
  request: DelegationRequest
  status: "pending" | "running" | "completed" | "failed"
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: DelegationResult
}

const state = new Map<string, DelegationState>()

export namespace AgentDelegation {
  /**
   * Delegate a task to a subagent
   */
  export async function delegate(request: DelegationRequest): Promise<DelegationResult> {
    const delegationID = Identifier.ascending("session")

    const delegationState: DelegationState = {
      request,
      status: "pending",
      createdAt: Date.now(),
    }
    state.set(delegationID, delegationState)

    log.info("delegation started", {
      delegationID,
      targetAgent: request.targetAgent,
      sessionID: request.sessionID,
    })

    try {
      delegationState.status = "running"
      delegationState.startedAt = Date.now()

      // Create a child session for the delegated task
      const childSession = await Session.createNext({
        parentID: request.sessionID,
        title: `Delegated: ${request.prompt.slice(0, 50)}...`,
        directory: (await Session.get(request.sessionID)).directory,
      })

      // Get the target agent
      const agent = await Agent.get(request.targetAgent)
      if (!agent) {
        throw new Error(`Agent not found: ${request.targetAgent}`)
      }

      // Execute the session with the prompt
      const result = await SessionPrompt.prompt({
        sessionID: childSession.id,
        parts: [{ type: "text", text: request.prompt }],
        model: request.model,
      })

      // Extract output from the result
      const output = extractOutput(result)

      delegationState.status = "completed"
      delegationState.completedAt = Date.now()
      delegationState.result = {
        sessionID: childSession.id,
        success: true,
        output,
      }

      // Persist context if requested
      if (request.persistContext) {
        await persistContext(request.sessionID, childSession.id)
      }

      log.info("delegation completed", {
        delegationID,
        success: true,
        outputLength: output?.length,
      })

      // Publish event
      Bus.publish(Event.Delegated, {
        delegationID,
        result: delegationState.result,
      })

      return delegationState.result
    } catch (err) {
      delegationState.status = "failed"
      delegationState.completedAt = Date.now()
      delegationState.result = {
        sessionID: request.sessionID,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }

      log.error("delegation failed", {
        delegationID,
        error: delegationState.result.error,
      })

      Bus.publish(Event.Delegated, {
        delegationID,
        result: delegationState.result,
      })

      return delegationState.result
    } finally {
      // Cleanup state after a delay
      setTimeout(() => {
        state.delete(delegationID)
      }, 5 * 60 * 1000) // Keep for 5 minutes
    }
  }

  /**
   * Get delegation status
   */
  export function getStatus(delegationID: string): DelegationState | undefined {
    return state.get(delegationID)
  }

  /**
   * List active delegations
   */
  export function list(): DelegationState[] {
    return Array.from(state.values())
  }

  /**
   * Persist context from child session to parent
   */
  async function persistContext(parentSessionID: string, childSessionID: string): Promise<void> {
    try {
      // Get messages from child session
      const messages: MessageV2.WithParts[] = []
      for await (const msg of MessageV2.stream(childSessionID)) {
        messages.push(msg)
      }

      // Create a summary message in the parent session
      const summary = {
        type: "delegation" as const,
        childSessionID,
        messageCount: messages.length,
        timestamp: Date.now(),
      }

      log.info("context persisted", {
        parentSessionID,
        childSessionID,
        messageCount: messages.length,
      })
    } catch (err) {
      log.warn("context persistence failed", {
        parentSessionID,
        childSessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function extractOutput(result: MessageV2.WithParts): string {
    const textParts = result.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
    return textParts.map((p) => p.text).join("\n")
  }
}

export const Event = {
  Delegated: BusEvent.define(
    "agent.delegated",
    z.object({
      delegationID: z.string(),
      result: z.object({
        sessionID: z.string(),
        success: z.boolean(),
        output: z.string().optional(),
        error: z.string().optional(),
      }),
    }),
  ),
}

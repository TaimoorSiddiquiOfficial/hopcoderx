/**
 * B4 - Dynamic Context Pruning Plugin
 *
 * Prunes obsolete tool outputs from the conversation context before
 * compaction and during message transforms. When the same tool has been
 * called on the same file multiple times, only the most recent result for
 * that (tool, filePath) pair is kept – earlier ones are replaced with a
 * compact placeholder.
 *
 * Hooks used:
 *   experimental.session.compacting – appends a pruning instruction so the
 *     compaction summary omits superseded tool results.
 *   experimental.chat.messages.transform – removes duplicate tool outputs
 *     inline before each LLM call.
 */

import type { Plugin, Hooks } from "@hopcoderx/plugin"
import type { Part, ToolPart } from "@hopcoderx/sdk"

type MsgEntry = { info: any; parts: Part[] }

function asTool(part: Part): ToolPart | undefined {
  return part.type === "tool" ? (part as ToolPart) : undefined
}

function extractFilePath(part: ToolPart): string | undefined {
  const input: any = (part.state as any)?.input ?? {}
  return input.filePath ?? input.file ?? input.path ?? undefined
}

function pruneMessages(messages: MsgEntry[]): void {
  // Map of "toolName:filePath" → last seen { msgIdx, partIdx }
  const seen = new Map<string, { msgIdx: number; partIdx: number }>()

  // Build index of latest completed occurrence
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    for (let pi = 0; pi < msg.parts.length; pi++) {
      const tp = asTool(msg.parts[pi])
      if (!tp) continue
      if ((tp.state as any)?.status !== "completed") continue
      const fp = extractFilePath(tp)
      if (!fp) continue
      const key = `${tp.tool}:${fp}`
      seen.set(key, { msgIdx: mi, partIdx: pi })
    }
  }

  // Replace earlier completed occurrences with a compact placeholder output
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    for (let pi = 0; pi < msg.parts.length; pi++) {
      const tp = asTool(msg.parts[pi])
      if (!tp) continue
      if ((tp.state as any)?.status !== "completed") continue
      const fp = extractFilePath(tp)
      if (!fp) continue
      const key = `${tp.tool}:${fp}`
      const latest = seen.get(key)
      if (!latest) continue
      if (latest.msgIdx === mi && latest.partIdx === pi) continue
      // Superseded – compact the output in-place
      ;(tp.state as any).output = `[pruned – superseded by a later ${tp.tool} call on ${fp}]`
    }
  }
}

export const ContextPruningPlugin: Plugin = async (_ctx): Promise<Hooks> => {
  return {
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(
        "When summarising, omit tool outputs that were superseded by a later call to the same tool on the same file. Keep only the most recent result per (tool, file) pair.",
      )
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      pruneMessages(output.messages as MsgEntry[])
    },
  }
}

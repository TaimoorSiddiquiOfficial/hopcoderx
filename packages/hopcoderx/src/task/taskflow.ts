/**
 * Task flow registry — multi-step tasks that survive agent restarts.
 *
 * A "task flow" is a named sequence of steps with:
 *   - Dependencies between steps
 *   - Per-step state (pending / running / done / failed)
 *   - Retry policy (max attempts, backoff)
 *   - Timeout per step
 *   - Audit log of executions
 *
 * Stored in SQLite at Global.Path.data/taskflows.db
 *
 * CLI: hopcoderx taskflow list|create|run|status|delete
 * Agent tool: execute-taskflow
 */

import { Database } from "bun:sqlite"
import { join } from "path"
import { mkdir } from "fs/promises"
import { Global } from "../global"

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped"
export type FlowStatus = "pending" | "running" | "done" | "failed" | "cancelled"

export interface TaskStep {
  id: string
  name: string
  command: string
  dependsOn: string[]
  maxAttempts: number
  timeoutMs: number
  status: StepStatus
  attempts: number
  output?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface TaskFlow {
  id: string
  name: string
  description: string
  steps: TaskStep[]
  status: FlowStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  tags: string[]
}

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (_db) return _db
  await mkdir(Global.Path.data, { recursive: true })
  _db = new Database(join(Global.Path.data, "taskflows.db"))
  _db.exec(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      steps TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      tags TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);
  `)
  return _db
}

function rowToFlow(row: any): TaskFlow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    steps: JSON.parse(row.steps),
    status: row.status as FlowStatus,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    tags: JSON.parse(row.tags ?? "[]"),
  }
}

export const TaskFlowRegistry = {
  async create(flow: Omit<TaskFlow, "id" | "createdAt" | "status">): Promise<TaskFlow> {
    const db = await getDb()
    const id = `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const full: TaskFlow = { ...flow, id, createdAt: now, status: "pending" }
    db.run(
      `INSERT INTO flows (id, name, description, steps, status, created_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, flow.name, flow.description, JSON.stringify(flow.steps), "pending", now, JSON.stringify(flow.tags)]
    )
    return full
  },

  async get(id: string): Promise<TaskFlow | undefined> {
    const db = await getDb()
    const row = db.query(`SELECT * FROM flows WHERE id = ?`).get(id)
    return row ? rowToFlow(row) : undefined
  },

  async list(status?: FlowStatus): Promise<TaskFlow[]> {
    const db = await getDb()
    const rows = status
      ? db.query(`SELECT * FROM flows WHERE status = ? ORDER BY created_at DESC`).all(status)
      : db.query(`SELECT * FROM flows ORDER BY created_at DESC LIMIT 100`).all()
    return (rows as any[]).map(rowToFlow)
  },

  async updateStatus(id: string, status: FlowStatus, extra?: { startedAt?: number; finishedAt?: number }): Promise<void> {
    const db = await getDb()
    const { startedAt, finishedAt } = extra ?? {}
    db.run(
      `UPDATE flows SET status = ?, started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at) WHERE id = ?`,
      [status, startedAt ?? null, finishedAt ?? null, id]
    )
  },

  async updateStep(flowId: string, stepId: string, update: Partial<TaskStep>): Promise<void> {
    const db = await getDb()
    const row = db.query(`SELECT steps FROM flows WHERE id = ?`).get(flowId) as any
    if (!row) return
    const steps: TaskStep[] = JSON.parse(row.steps)
    const idx = steps.findIndex((s) => s.id === stepId)
    if (idx < 0) return
    steps[idx] = { ...steps[idx], ...update }
    db.run(`UPDATE flows SET steps = ? WHERE id = ?`, [JSON.stringify(steps), flowId])
  },

  async delete(id: string): Promise<void> {
    const db = await getDb()
    db.run(`DELETE FROM flows WHERE id = ?`, [id])
  },

  /** Run all pending steps whose dependencies are satisfied (topological execution) */
  async executeReady(flowId: string, executor: (step: TaskStep) => Promise<string>): Promise<void> {
    const flow = await this.get(flowId)
    if (!flow || flow.status === "done" || flow.status === "cancelled") return

    await this.updateStatus(flowId, "running", { startedAt: Date.now() })

    let madeProgress = true
    while (madeProgress) {
      madeProgress = false
      const current = await this.get(flowId)
      if (!current) break

      for (const step of current.steps) {
        if (step.status !== "pending") continue

        // Check all dependencies are done
        const depsOk = step.dependsOn.every(
          (depId) => current.steps.find((s) => s.id === depId)?.status === "done"
        )
        if (!depsOk) continue

        // Check for any failed dependency
        const depFailed = step.dependsOn.some(
          (depId) => current.steps.find((s) => s.id === depId)?.status === "failed"
        )
        if (depFailed) {
          await this.updateStep(flowId, step.id, { status: "skipped" })
          madeProgress = true
          continue
        }

        await this.updateStep(flowId, step.id, { status: "running", startedAt: Date.now(), attempts: step.attempts + 1 })
        madeProgress = true

        try {
          const output = await Promise.race([
            executor(step),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Step timeout")), step.timeoutMs || 60000)),
          ])
          await this.updateStep(flowId, step.id, { status: "done", output, finishedAt: Date.now() })
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          const attempts = step.attempts + 1
          if (attempts < (step.maxAttempts || 1)) {
            await this.updateStep(flowId, step.id, { status: "pending", error, attempts })
          } else {
            await this.updateStep(flowId, step.id, { status: "failed", error, finishedAt: Date.now() })
          }
        }
      }
    }

    // Determine final flow status
    const final = await this.get(flowId)
    if (!final) return
    const hasFailed = final.steps.some((s) => s.status === "failed")
    const allDone = final.steps.every((s) => ["done", "skipped", "failed"].includes(s.status))
    if (allDone) {
      await this.updateStatus(flowId, hasFailed ? "failed" : "done", { finishedAt: Date.now() })
    }
  },
}

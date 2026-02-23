import { bigint, index, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const AgentJobStatus = ["queued", "running", "done", "failed"] as const
export const AgentJobTier = ["free", "mini", "pro", "engineer"] as const

export const AgentJobTable = mysqlTable(
  "agent_job",
  {
    ...workspaceColumns,
    ...timestamps,
    task: varchar("task", { length: 2000 }).notNull(),
    tier: varchar("tier", { length: 20 }).notNull().default("free"),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    step_count: int("step_count").notNull().default(0),
    models_used: json("models_used").$type<string[]>(),
    total_tokens: int("total_tokens").notNull().default(0),
    total_cost: bigint("total_cost", { mode: "number" }).notNull().default(0),
    context: json("context").$type<{
      task: string
      steps: {
        id: string
        task: string
        model: string
        agent: string
        depends_on: string[]
        refs: string[]
        gaps: string[]
        status: "pending" | "running" | "done" | "failed"
        output?: string
        tokens?: number
        cost?: number
      }[]
      context: { refs: Record<string, string>; gaps: string[] }
      tier?: string
      created_at: number
    }>(),
    time_finished: utc("time_finished"),
  },
  (table) => [
    ...workspaceIndexes(table),
    index("agent_job_status").on(table.workspaceID, table.status),
    index("agent_job_time").on(table.workspaceID, table.timeCreated),
  ],
)

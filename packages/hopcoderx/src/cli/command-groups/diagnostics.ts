import { DebugCommand } from "../cmd/debug"
import { StatsCommand } from "../cmd/stats"
import { DbCommand } from "../cmd/db"
import { DoctorCommand } from "../cmd/doctor"
import { StatusCommand } from "../cmd/status"
import { CompletionCommand } from "../cmd/completion"

export const diagnosticsCommandGroup = {
  name: "diagnostics",
  title: "Diagnostics & maintenance",
  summary: ["doctor", "status", "debug", "stats", "db", "completion"],
  commands: [DoctorCommand, StatusCommand, DebugCommand, StatsCommand, DbCommand, CompletionCommand],
}

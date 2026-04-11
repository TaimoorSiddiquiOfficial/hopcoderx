import { DebugCommand } from "../cmd/debug"
import { StatsCommand } from "../cmd/stats"
import { DbCommand } from "../cmd/db"
import { DoctorCommand } from "../cmd/doctor"
import { StatusCommand } from "../cmd/status"
import { CompletionCommand } from "../cmd/completion"
import { diagnosticsTaxonomy } from "../command-taxonomy"

export const diagnosticsCommandGroup = {
  ...diagnosticsTaxonomy,
  commands: [DoctorCommand, StatusCommand, DebugCommand, StatsCommand, DbCommand, CompletionCommand],
}

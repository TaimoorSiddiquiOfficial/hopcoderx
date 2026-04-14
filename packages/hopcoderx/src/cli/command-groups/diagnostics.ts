import { DebugCommand } from "../cmd/debug"
import { StatsCommand } from "../cmd/stats"
import { DbCommand } from "../cmd/db"
import { DoctorCommand } from "../cmd/doctor"
import { StatusCommand } from "../cmd/status"
import { CompletionCommand } from "../cmd/completion"
import { ConfigCommand } from "../cmd/config"
import { PaletteCommand } from "../cmd/palette"
import { DebugSessionCommand, DebugTraceCommand, DebugReplayCommand } from "../cmd/debug-session"
import { AuditCommand } from "../cmd/audit"
import { diagnosticsTaxonomy } from "../command-taxonomy"

export const diagnosticsCommandGroup = {
  ...diagnosticsTaxonomy,
  commands: [
    DoctorCommand,
    StatusCommand,
    DebugCommand,
    DebugSessionCommand,
    DebugTraceCommand,
    DebugReplayCommand,
    StatsCommand,
    DbCommand,
    CompletionCommand,
    ConfigCommand,
    PaletteCommand,
    AuditCommand,
  ],
}

// Re-export CompletionCommand for use in completion.ts
export { CompletionCommand }

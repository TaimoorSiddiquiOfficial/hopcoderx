import { RunCommand } from "../cmd/run"
import { AttachCommand } from "../cmd/tui/attach"
import { TuiThreadCommand } from "../cmd/tui/thread"
import { AcpCommand } from "../cmd/acp"
import { SessionCommand } from "../cmd/session"
import { ReplayCommand } from "../cmd/replay"
import { sessionTaxonomy } from "../command-taxonomy"

export const sessionCommandGroup = {
  ...sessionTaxonomy,
  commands: [AcpCommand, TuiThreadCommand, AttachCommand, RunCommand, SessionCommand, ReplayCommand],
}

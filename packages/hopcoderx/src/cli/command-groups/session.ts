import { RunCommand } from "../cmd/run"
import { AttachCommand } from "../cmd/tui/attach"
import { TuiThreadCommand } from "../cmd/tui/thread"
import { AcpCommand } from "../cmd/acp"
import { SessionCommand } from "../cmd/session"
import { ReplayCommand } from "../cmd/replay"

export const sessionCommandGroup = {
  name: "session",
  title: "Session & TUI",
  summary: ["[project]", "attach", "run", "session", "replay", "acp"],
  commands: [AcpCommand, TuiThreadCommand, AttachCommand, RunCommand, SessionCommand, ReplayCommand],
}

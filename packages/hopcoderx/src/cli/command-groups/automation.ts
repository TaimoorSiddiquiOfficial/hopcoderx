import { GenerateCommand } from "../cmd/generate"
import { AgentCommand } from "../cmd/agent"
import { ExportCommand } from "../cmd/export"
import { ImportCommand } from "../cmd/import"
import { SecretsCommand } from "../cmd/secrets"
import { SecurityCommand } from "../cmd/security"
import { AnalyticsCommand } from "../cmd/analytics"
import { MemoryCommand } from "../cmd/memory"
import { SandboxCommand } from "../cmd/sandbox"
import { AccessibilityCommand } from "../cmd/accessibility"
import { TaskflowCommand } from "../cmd/taskflow"
import { WorktreeCommand } from "../cmd/worktree"
import { PromptsCommand } from "../cmd/prompts"
import { CostCommand } from "../cmd/cost"
import { SbomCommand } from "../cmd/sbom"
import { DiffCommand } from "../cmd/diff"
import { PermissionCommand } from "../cmd/permission"
import { FeedbackCommand } from "../cmd/feedback"
import { TelemetryCommand } from "../cmd/telemetry"
import { automationTaxonomy } from "../command-taxonomy"

export const automationCommandGroup = {
  ...automationTaxonomy,
  commands: [
    GenerateCommand,
    AgentCommand,
    ExportCommand,
    ImportCommand,
    SecretsCommand,
    SecurityCommand,
    AnalyticsCommand,
    MemoryCommand,
    SandboxCommand,
    AccessibilityCommand,
    TaskflowCommand,
    WorktreeCommand,
    PromptsCommand,
    CostCommand,
    SbomCommand,
    DiffCommand,
    PermissionCommand,
    FeedbackCommand,
    TelemetryCommand,
  ],
}

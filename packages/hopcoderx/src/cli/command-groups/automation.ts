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

export const automationCommandGroup = {
  name: "automation",
  title: "Automation & workflows",
  summary: [
    "generate",
    "agent",
    "export",
    "import",
    "secrets",
    "security",
    "analytics",
    "memory",
    "sandbox",
    "taskflow",
    "worktree",
    "prompts",
    "cost",
    "sbom",
    "diff",
    "permission",
  ],
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
  ],
}

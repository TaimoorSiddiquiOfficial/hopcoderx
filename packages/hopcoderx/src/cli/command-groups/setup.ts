import { AuthCommand } from "../cmd/auth"
import { UpgradeCommand } from "../cmd/upgrade"
import { RepairCommand } from "../cmd/repair"
import { UninstallCommand } from "../cmd/uninstall"
import { ModelsCommand } from "../cmd/models"
import { OnboardCommand } from "../cmd/onboard"

export const setupCommandGroup = {
  name: "setup",
  title: "Setup & install",
  summary: ["onboard", "auth", "models", "upgrade", "repair", "uninstall"],
  commands: [OnboardCommand, AuthCommand, ModelsCommand, UpgradeCommand, RepairCommand, UninstallCommand],
}

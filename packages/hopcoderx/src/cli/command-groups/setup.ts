import { AuthCommand } from "../cmd/auth"
import { UpgradeCommand } from "../cmd/upgrade"
import { RepairCommand } from "../cmd/repair"
import { UninstallCommand } from "../cmd/uninstall"
import { ModelsCommand } from "../cmd/models"
import { OnboardCommand } from "../cmd/onboard"
import { setupTaxonomy } from "../command-taxonomy"

export const setupCommandGroup = {
  ...setupTaxonomy,
  commands: [OnboardCommand, AuthCommand, ModelsCommand, UpgradeCommand, RepairCommand, UninstallCommand],
}

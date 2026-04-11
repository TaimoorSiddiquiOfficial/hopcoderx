import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Installation } from "../../installation"

interface RepairArgs {
  fix: boolean
  json: boolean
  yes: boolean
}

export const RepairCommand = cmd({
  command: "repair",
  describe: "detect and repair common install and launcher issues",
  builder: (yargs: Argv) =>
    yargs
      .option("fix", {
        describe: "apply safe automatic repairs",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "output repair analysis as JSON",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        alias: "y",
        describe: "skip confirmation prompts when applying repairs",
        type: "boolean",
        default: false,
      }),
  handler: async (args: RepairArgs) => {
    if (!args.json) {
      UI.empty()
      UI.println(UI.logo("  "))
      UI.empty()
      prompts.intro("Repair")
    }

    let plan = await Installation.recoveryPlan()
    let attemptedFix = false
    let removedPaths: string[] = []

    if (args.fix && plan.shimConflicts.length > 0) {
      let shouldFix = true
      if (!args.json && !args.yes) {
        const confirm = await prompts.confirm({
          message: "Remove stale Bun launcher shims now?",
          initialValue: true,
        })
        shouldFix = !!confirm && !prompts.isCancel(confirm)
      }

      if (shouldFix) {
        attemptedFix = true
        removedPaths = Installation.repairShimConflicts(plan.shimConflicts)
        plan = await Installation.recoveryPlan()
      }
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ...plan,
            attemptedFix,
            removedPaths,
          },
          null,
          2,
        ),
      )
      if (plan.warnings.length > 0) process.exitCode = 1
      return
    }

    prompts.log.info(`Launcher: ${plan.launcherPath}`)
    prompts.log.info(`Active method: ${plan.displayMethod}`)
    prompts.log.info(
      `Detected installs: ${plan.installedMethods.length > 0 ? plan.installedMethods.join(", ") : "none detected"}`,
    )

    if (attemptedFix) {
      if (removedPaths.length > 0) {
        prompts.log.success(`Removed ${removedPaths.length} stale launcher file${removedPaths.length === 1 ? "" : "s"}`)
      } else {
        prompts.log.warn("No stale launcher files were removed")
      }
    }

    if (plan.warnings.length === 0) {
      prompts.log.success("No install or launcher issues detected")
    } else {
      for (const warning of plan.warnings) {
        prompts.log.warn(warning)
      }
    }

    if (plan.steps.length > 0) {
      prompts.log.message("Suggested recovery steps:")
      for (const step of plan.steps) {
        const prefix = step.automated ? "  ✓" : "  →"
        prompts.log.info(`${prefix} ${step.label}`)
        if (step.command) prompts.log.info(`    ${step.command}`)
      }
    }

    prompts.outro("Done")
    if (plan.warnings.length > 0) process.exitCode = 1
  },
})

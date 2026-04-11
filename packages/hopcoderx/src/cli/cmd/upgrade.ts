import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade HopCoderX to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const recovery = await Installation.recoveryPlan()
    for (const warning of recovery.warnings) {
      prompts.log.warn(warning)
    }
    if (recovery.shimConflicts.length > 0) {
      prompts.log.info("Run `hopcoderx repair --fix` first if the active launcher is failing before HopCoderX starts.")
    }

    const detectedMethod = await Installation.method()
    let method = args.method as Installation.Method | undefined

    if (!method) {
      const selectableMethods = Array.from(
        new Set<Installation.Method>(
          [
            recovery.displayMethod !== "local" ? recovery.displayMethod : undefined,
            ...recovery.installedMethods,
            detectedMethod,
          ].filter((value): value is Installation.Method => !!value && value !== "unknown"),
        ),
      )

      if (selectableMethods.length > 1) {
        const selected = await prompts.select({
          message: "Choose the package manager to upgrade with",
          options: selectableMethods.map((candidate) => ({
            label: candidate === recovery.displayMethod ? `${candidate} (active launcher)` : candidate,
            value: candidate,
          })),
          initialValue: selectableMethods[0],
        })
        if (prompts.isCancel(selected)) {
          prompts.outro("Done")
          return
        }
        method = selected as Installation.Method
      } else {
        method = selectableMethods[0] ?? detectedMethod
      }
    }

    if (method === "unknown") {
      prompts.log.error(`HopCoderX is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target
      ? args.target.replace(/^v/, "")
      : await Installation.latest().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          prompts.log.error(
            `Unable to fetch latest version: ${msg}\nSpecify a version manually: hopcoderx upgrade <version>`,
          )
          prompts.outro("Done")
          process.exit(1)
        })

    if (Installation.VERSION === target) {
      prompts.log.warn(`HopCoderX upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        // necessary because choco only allows install/upgrade in elevated terminals
        if (method === "choco" && err.data.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else if (Installation.isEbusyError(err.data.stderr) && (method === "npm" || method === "pnpm" || method === "bun")) {
          // Windows: hopcoderx.exe is locked — schedule a deferred upgrade via PS1
          prompts.log.warn("HopCoderX is currently running — cannot overwrite the binary directly.")
          const schedule = await prompts.select({
            message: "Schedule upgrade to run automatically after you close HopCoderX?",
            options: [
              { label: "Yes — schedule and exit", value: "schedule" },
              { label: "No — I'll run it manually", value: "manual" },
            ],
            initialValue: "schedule",
          })
          if (prompts.isCancel(schedule) || schedule === "manual") {
            prompts.log.info(`Manual fix — close HopCoderX, then run:\n  ${Installation.installCommand(method, target)}`)
          } else {
            const scheduled = await Installation.scheduleWindowsUpgrade(target, method as "npm" | "pnpm" | "bun")
            prompts.log.success(
              `Upgrade to ${target} scheduled!\nClose HopCoderX now and the upgrade will complete automatically.\nLog: ${scheduled.logPath}`,
            )
          }
        } else {
          prompts.log.error(err.data.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}

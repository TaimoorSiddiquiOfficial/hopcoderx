import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Installation } from "../../installation"
import { execSync } from "child_process"
import open from "open"

export const FeedbackCommand = cmd({
  command: "feedback",
  describe: "submit feedback, bug reports, or feature requests",
  builder: (yargs: Argv) =>
    yargs
      .option("type", {
        type: "string",
        choices: ["bug", "feature", "general"],
        describe: "type of feedback",
        default: "general",
      })
      .option("open", {
        type: "boolean",
        describe: "open GitHub issue in browser",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Feedback")

    if (args.open) {
      const issueUrl = "https://github.com/TaimoorSiddiquiOfficial/hopcoderx/issues/new"
      try {
        await open(issueUrl)
        prompts.log.success("Opened GitHub issues page in your browser")
      } catch (error) {
        prompts.log.error(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`)
        prompts.log.info(`Visit: ${issueUrl}`)
      }
      prompts.outro("Done")
      return
    }

    // Collect feedback details
    const feedbackType =
      args.type === "bug" || args.type === "feature"
        ? args.type
        : await prompts.select({
            message: "Feedback type",
            options: [
              { label: "🐛 Bug Report", value: "bug" },
              { label: "💡 Feature Request", value: "feature" },
              { label: "💬 General Feedback", value: "general" },
            ],
          })

    if (prompts.isCancel(feedbackType)) throw new UI.CancelledError()

    const title = await prompts.text({
      message: "Brief title",
      validate: (value) => (value.length < 10 ? "Please enter at least 10 characters" : undefined),
    })

    if (prompts.isCancel(title)) throw new UI.CancelledError()

    const description = await prompts.text({
      message: "Description (brief)",
      placeholder: "Describe your feedback in a few sentences",
      validate: (value) => (value.length < 20 ? "Please enter at least 20 characters" : undefined),
    })

    if (prompts.isCancel(description)) throw new UI.CancelledError()

    // Gather diagnostic info
    const spinner = prompts.spinner()
    spinner.start("Gathering diagnostic information")

    let diagnostics = {
      version: Installation.VERSION,
      platform: process.platform,
      nodeVersion: process.version,
      bunVersion: process.versions.bun ?? "unknown",
    }

    try {
      const gitVersion = execSync("git --version 2>/dev/null || git --version 2>NUL", { stdio: "pipe" })
        .toString()
        .trim()
      diagnostics = { ...diagnostics, gitVersion }
    } catch {
      // Git not available - not critical
    }

    spinner.stop()

    // Build GitHub issue URL with pre-filled content
    const issueBody = `
## Feedback Type
${feedbackType === "bug" ? "🐛 Bug Report" : feedbackType === "feature" ? "💡 Feature Request" : "💬 General Feedback"}

## Description
${description}

## System Information
- **HopCoderX Version:** ${diagnostics.version}
- **Platform:** ${diagnostics.platform}
- **Node.js:** ${diagnostics.nodeVersion}
- **Bun:** ${diagnostics.bunVersion}${diagnostics.gitVersion ? `\n- **Git:** ${diagnostics.gitVersion}` : ""}

## Steps to Reproduce (if applicable)
1.
2.
3.

## Expected Behavior


## Actual Behavior


## Additional Context

`.trim()

    const githubUrl = `https://github.com/TaimoorSiddiquiOfficial/hopcoderx/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}`

    prompts.log.info("\nOpening GitHub issue page with pre-filled content...")

    try {
      await open(githubUrl)
      prompts.log.success("GitHub issue page opened in your browser")
    } catch (error) {
      prompts.log.error(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`)
      prompts.log.info(`Visit: ${githubUrl}`)
    }

    prompts.outro("Thank you for your feedback!")
  },
})

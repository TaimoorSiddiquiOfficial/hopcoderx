/**
 * hopcoderx channels — manage messaging channel integrations
 *
 * Usage:
 *   hopcoderx channels list              List configured channels
 *   hopcoderx channels status            Show which channels are available
 *   hopcoderx channels issues            List open GitHub issues
 *   hopcoderx channels send <ch> <to>    Send a test message
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { ChannelRegistry } from "../../channels/channel"
import { GitHubIssuesChannel } from "../../channels/github-issues"
import { TelegramChannel } from "../../channels/telegram"
import { PagerDutyChannel } from "../../channels/pagerduty"
import { LinearChannel } from "../../channels/linear"
import { DiscordChannel } from "../../channels/discord"
import { TeamsChannel } from "../../channels/teams"
import { WhatsAppChannel } from "../../channels/whatsapp"
import { MatrixChannel } from "../../channels/matrix"
import { SignalChannel } from "../../channels/signal"
import { IRCChannel } from "../../channels/irc"
import { MattermostChannel } from "../../channels/mattermost"
import { LINEChannel } from "../../channels/line"

// Register built-in channels on first import
ChannelRegistry.register(new GitHubIssuesChannel())
ChannelRegistry.register(new TelegramChannel())
ChannelRegistry.register(new PagerDutyChannel())
ChannelRegistry.register(new LinearChannel())
ChannelRegistry.register(new DiscordChannel())
ChannelRegistry.register(new TeamsChannel())
ChannelRegistry.register(new WhatsAppChannel())
ChannelRegistry.register(new MatrixChannel())
ChannelRegistry.register(new SignalChannel())
ChannelRegistry.register(new IRCChannel())
ChannelRegistry.register(new MattermostChannel())
ChannelRegistry.register(new LINEChannel())

export const ChannelsCommand = cmd({
  command: "channels <action>",
  describe: "Manage messaging channel integrations (GitHub Issues, Slack, Discord, etc.)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["list", "status", "issues", "send"] as const,
        describe: "Action to perform",
      })
      .option("channel", { alias: "c", type: "string", describe: "Channel ID (for send)" })
      .option("to", { type: "string", describe: "Target (for send, e.g. owner/repo/issues/5)" })
      .option("message", { alias: "m", type: "string", describe: "Message body (for send)" }),
  async handler(args) {
    const action = (args.action as string) ?? "list"

    if (action === "list") {
      const all = ChannelRegistry.all()
      if (all.length === 0) {
        console.log("No channels registered.")
        return
      }
      console.log("Registered channels:")
      for (const ch of all) {
        const avail = ch.isAvailable() ? "✅ available" : "⚠️  not configured"
        const caps = [ch.config.canReceive ? "receive" : null, ch.config.canSend ? "send" : null]
          .filter(Boolean)
          .join(", ")
        console.log(`  ${ch.config.id.padEnd(20)} ${ch.config.name.padEnd(20)} [${caps}]  ${avail}`)
        if (!ch.isAvailable()) {
          console.log(`    Missing: ${ch.config.envVars.join(", ")}`)
        }
      }
      return
    }

    if (action === "status") {
      const available = ChannelRegistry.available()
      console.log(`Available channels: ${available.length} / ${ChannelRegistry.all().length}`)
      for (const ch of available) {
        console.log(`  ✅ ${ch.config.id} (${ch.config.name})`)
      }
      const unavailable = ChannelRegistry.all().filter((c) => !c.isAvailable())
      if (unavailable.length > 0) {
        console.log("Unavailable (not configured):")
        for (const ch of unavailable) {
          console.log(`  ⚠️  ${ch.config.id} — set ${ch.config.envVars.join(", ")}`)
        }
      }
      return
    }

    if (action === "issues") {
      const gh = ChannelRegistry.get("github-issues") as GitHubIssuesChannel | undefined
      if (!gh || !gh.isAvailable()) {
        console.error("GitHub Issues channel not configured. Set GITHUB_CHANNEL_TOKEN and GITHUB_CHANNEL_REPO.")
        process.exit(1)
      }
      try {
        const issues = await gh.listOpenIssues()
        if (issues.length === 0) {
          console.log("No open issues.")
          return
        }
        console.log(`Open issues in ${process.env.GITHUB_CHANNEL_REPO}:`)
        for (const issue of issues.slice(0, 20)) {
          console.log(`  #${String(issue.number).padEnd(5)} ${issue.title.slice(0, 60)} [${issue.labels?.map((l: any) => l.name).join(", ") || "no labels"}]`)
        }
        if (issues.length > 20) console.log(`  … and ${issues.length - 20} more`)
      } catch (e) {
        console.error("Failed to fetch issues:", e instanceof Error ? e.message : e)
        process.exit(1)
      }
      return
    }

    if (action === "send") {
      const channelId = args.channel as string | undefined
      const to = args.to as string | undefined
      const message = args.message as string | undefined
      if (!channelId || !to || !message) {
        console.error("Usage: hopcoderx channels send --channel <id> --to <target> --message <text>")
        process.exit(1)
      }
      try {
        await ChannelRegistry.send(channelId, to, { text: message })
        console.log(`✅ Message sent via ${channelId} to ${to}`)
      } catch (e) {
        console.error("Send failed:", e instanceof Error ? e.message : e)
        process.exit(1)
      }
      return
    }

    console.error(`Unknown action: ${action}. Use list|status|issues|send`)
    process.exit(1)
  },
})

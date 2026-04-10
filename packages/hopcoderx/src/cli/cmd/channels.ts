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
import { SlackChannel } from "../../channels/slack"
import { FeishuChannel } from "../../channels/feishu"
import { GoogleChatChannel } from "../../channels/googlechat"
import { TwitchChannel } from "../../channels/twitch"
import { SynologyChatChannel } from "../../channels/synology-chat"
import { NextcloudTalkChannel } from "../../channels/nextcloud-talk"
import { NostrChannel } from "../../channels/nostr"
import { WebChatChannel } from "../../channels/webchat"

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
ChannelRegistry.register(new SlackChannel())
ChannelRegistry.register(new FeishuChannel())
ChannelRegistry.register(new GoogleChatChannel())
ChannelRegistry.register(new TwitchChannel())
ChannelRegistry.register(new SynologyChatChannel())
ChannelRegistry.register(new NextcloudTalkChannel())
ChannelRegistry.register(new NostrChannel())
ChannelRegistry.register(new WebChatChannel())

export const ChannelsCommand = cmd({
  command: "channels <action>",
  describe: "Manage messaging channel integrations (GitHub Issues, Slack, Discord, etc.)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["list", "status", "issues", "send", "diagnose"] as const,
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

    if (action === "diagnose") {
      const channelId = args.channel as string | undefined
      let results
      if (channelId) {
        const ch = ChannelRegistry.get(channelId)
        if (!ch) {
          console.error(`Channel "${channelId}" not found. Use 'channels list' to see registered channels.`)
          process.exit(1)
        }
        if (!ch.diagnose) {
          console.log(`Channel "${channelId}" does not implement diagnose().`)
          return
        }
        results = [await ch.diagnose()]
      } else {
        results = await ChannelRegistry.diagnoseAll()
      }

      console.log("")
      const W = { id: 22, status: 15, summary: 42 }
      const header = `  ${"CHANNEL".padEnd(W.id)} ${"STATUS".padEnd(W.status)} SUMMARY`
      console.log(`\x1b[1m${header}\x1b[0m`)
      console.log("  " + "─".repeat(header.length - 2))

      for (const r of results) {
        const statusText = r.ok ? "\x1b[32m✓ ok\x1b[0m          " : "\x1b[31m✗ error\x1b[0m       "
        console.log(`  ${r.channelId.padEnd(W.id)} ${statusText}${r.summary}`)
        for (const c of r.checks ?? []) {
          const mark = c.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"
          const detail = c.detail ? `  \x1b[2m${c.detail}\x1b[0m` : ""
          console.log(`      ${mark} ${c.name}${detail}`)
        }
      }

      const failed = results.filter((r) => !r.ok)
      console.log("")
      if (failed.length === 0) {
        console.log("\x1b[32m✓ All diagnosed channels healthy\x1b[0m")
      } else {
        console.log(`\x1b[31m✗ ${failed.length} channel(s) have issues\x1b[0m`)
      }
      return
    }

    console.error(`Unknown action: ${action}. Use list|status|issues|send|diagnose`)
    process.exit(1)
  },
})

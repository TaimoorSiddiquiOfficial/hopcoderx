/**
 * hopcoderx channels — manage messaging channel integrations
 *
 * Usage:
 *   hopcoderx channels list              List configured channels
 *   hopcoderx channels status            Show which channels are available
 *   hopcoderx channels issues            List open GitHub issues
 *   hopcoderx channels send <ch> <to>    Send a test message
 *   hopcoderx channels listen            Start auto-reply on all configured channels
 *   hopcoderx channels setup             Interactive setup wizard for a channel
 */

import path from "node:path"
import fs from "node:fs"
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
import { AutoReplyEngine } from "../../channels/auto-reply"
import { bootstrap } from "../bootstrap"
import { Server } from "../../server/server"
import { createHopCoderXClient } from "@hopcoderx/sdk/v2"
import * as p from "@clack/prompts"

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
        choices: ["list", "status", "issues", "send", "diagnose", "listen", "setup"] as const,
        describe: "Action to perform",
      })
      .option("channel", { alias: "c", type: "string", describe: "Channel ID (for send/diagnose/listen/setup)" })
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

    if (action === "listen") {
      const channelFilter = args.channel as string | undefined
      await bootstrap(process.cwd(), async () => {
        const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          return Server.App().fetch(request)
        }) as typeof globalThis.fetch
        const sdk = createHopCoderXClient({ baseUrl: "http://hopcoderx.internal", fetch: fetchFn })
        const sessionMap = new Map<string, string>()

        const engine = new AutoReplyEngine(channelFilter ? { enabledChannels: [channelFilter] } : {})
        engine.setHandler(async (messages, threadId, channelId) => {
          const key = `${channelId}:${threadId}`
          let sessionId = sessionMap.get(key)
          if (!sessionId) {
            const result = await sdk.session.create({ title: `${channelId}:${threadId}` })
            sessionId = result.data?.id
            if (!sessionId) return ""
            sessionMap.set(key, sessionId)
          }

          const text = messages.map((m) => m.text).filter(Boolean).join("\n")
          const events = await sdk.event.subscribe()
          let reply = ""
          const done = (async () => {
            for await (const event of events.stream) {
              if (event.type === "message.part.updated") {
                const part = event.properties.part
                if (part.sessionID !== sessionId) continue
                if (part.type === "text" && part.time?.end) reply += part.text
              }
              if (
                event.type === "session.status" &&
                event.properties.sessionID === sessionId &&
                event.properties.status.type === "idle"
              ) break
            }
          })()

          await sdk.session.prompt({ sessionID: sessionId, parts: [{ type: "text", text }] })
          await done
          return reply.trim()
        })

        const available = channelFilter
          ? ChannelRegistry.available().filter((c) => c.config.id === channelFilter)
          : ChannelRegistry.available()

        if (available.length === 0) {
          console.log(
            channelFilter
              ? `Channel "${channelFilter}" not available — check env vars.`
              : "No channels configured. Run 'hopcoderx channels setup' to configure a channel.",
          )
          process.exit(1)
        }

        console.log(`Starting auto-reply on ${available.length} channel(s)…`)
        await engine.startAll()
        console.log("✅ Listening. Press Ctrl+C to stop.")

        await new Promise<void>((resolve) => {
          const shutdown = async () => {
            console.log("\n[channels] Stopping…")
            await engine.stopAll()
            resolve()
          }
          process.once("SIGINT", shutdown)
          process.once("SIGTERM", shutdown)
        })
      })
      return
    }

    if (action === "setup") {
      const channelIdArg = args.channel as string | undefined
      let target: string

      if (channelIdArg) {
        target = channelIdArg
        p.intro(`HopCoderX Channel Setup — ${target}`)
      } else {
        p.intro("HopCoderX Channel Setup")
        const all = ChannelRegistry.all()
        const choice = await p.select({
          message: "Which channel would you like to set up?",
          options: all.map((ch) => ({
            value: ch.config.id,
            label: `${ch.config.name}`,
            hint: ch.isAvailable() ? "✅ configured" : ch.config.envVars.join(", ") || "no env vars",
          })),
        })
        if (p.isCancel(choice)) {
          p.cancel("Cancelled.")
          return
        }
        target = choice as string
      }

      const ch = ChannelRegistry.get(target)
      if (!ch) {
        console.error(`Channel "${target}" not found. Use 'channels list' to see registered channels.`)
        process.exit(1)
      }

      // WhatsApp special case — QR code auth
      if (target === "whatsapp") {
        const wa = ch as WhatsAppChannel
        const spinner = p.spinner()
        spinner.start("Generating WhatsApp QR code…")
        const result = await wa.startQrLogin()
        spinner.stop(result.message)

        if (result.qrTerminal) {
          console.log("\n" + result.qrTerminal)
        } else if (!result.qrDataUrl) {
          p.outro("⚠️  Could not generate QR — " + result.message)
          return
        }

        const waitSpinner = p.spinner()
        waitSpinner.start("Waiting for QR scan (2 min)…")
        const loginResult = await wa.waitForLogin({ timeoutMs: 120_000 })
        waitSpinner.stop(loginResult.connected ? "✅ WhatsApp linked!" : "⚠️  " + loginResult.message)
        p.outro("WhatsApp setup complete.")
        return
      }

      // Generic env var setup
      if (ch.config.envVars.length === 0) {
        p.outro(`${ch.config.name} requires no env vars — it's always available.`)
        return
      }

      const envValues: Record<string, string> = {}
      for (const key of ch.config.envVars) {
        const current = process.env[key]
        const value = await p.text({
          message: key,
          placeholder: current ? "(press Enter to keep current value)" : "(required)",
          initialValue: current ?? "",
        })
        if (p.isCancel(value)) {
          p.cancel("Cancelled.")
          return
        }
        if (value) envValues[key] = value as string
      }

      // Write to .env in current directory
      const envFile = path.join(process.cwd(), ".env")
      let envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf-8") : ""
      for (const [key, value] of Object.entries(envValues)) {
        const regex = new RegExp(`^${key}=.*$`, "m")
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`)
        } else {
          envContent += (envContent.endsWith("\n") || envContent === "" ? "" : "\n") + `${key}=${value}\n`
        }
        process.env[key] = value
      }
      fs.writeFileSync(envFile, envContent, "utf-8")

      const ok = ch.isAvailable()
      p.outro(ok ? `✅ ${ch.config.name} configured! Run 'hopcoderx channels listen' to start.` : `⚠️  ${ch.config.name} not fully configured yet.`)
      return
    }

    console.error(`Unknown action: ${action}. Use list|status|issues|send|diagnose|listen|setup`)
    process.exit(1)
  },
})

/**
 * HopCoderX tailscale — Tailscale VPN integration.
 *
 * Query connected devices, generate auth keys, get node status,
 * and open the Tailscale admin console.
 *
 * CLI: `hopcoderx tailscale status|devices|auth-key|ping|console`
 *
 * Requires TAILSCALE_API_KEY or `tailscale` CLI in PATH.
 */

import { execFile } from "child_process"
import { promisify } from "util"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

const execAsync = promisify(execFile)

const TAILSCALE_API = "https://api.tailscale.com/api/v2"

// ─── helpers ────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key = process.env.TAILSCALE_API_KEY
  if (!key) {
    console.error(
      "TAILSCALE_API_KEY not set. Export your Tailscale API key:\n" +
        "  export TAILSCALE_API_KEY=tskey-api-xxxx\n" +
        "Get a key at https://login.tailscale.com/admin/settings/keys",
    )
    process.exit(1)
  }
  return key
}

function tailnet(): string {
  return process.env.TAILSCALE_TAILNET ?? "-"
}

async function tsApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${TAILSCALE_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Tailscale API error ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

interface TsDevice {
  id: string
  name: string
  hostname: string
  os: string
  addresses: string[]
  user: string
  lastSeen: string
  online: boolean
  authorized: boolean
  tags?: string[]
}

// ─── commands ────────────────────────────────────────────────────────────────

export const TailscaleCommand = cmd({
  command: "tailscale <action>",
  describe: "Tailscale VPN integration — devices, auth keys, status",
  builder(yargs: Argv) {
    return yargs
      .positional("action", {
        type: "string",
        choices: ["status", "devices", "auth-key", "ping", "console"] as const,
        describe: "Action to perform",
      })
      .option("tag", {
        type: "array",
        string: true,
        describe: "ACL tags for auth key (e.g. --tag tag:ci)",
      })
      .option("expiry", {
        type: "number",
        describe: "Auth key expiry in seconds (default: 86400 = 1 day)",
        default: 86400,
      })
      .option("reusable", {
        type: "boolean",
        describe: "Create a reusable auth key",
        default: false,
      })
      .option("ephemeral", {
        type: "boolean",
        describe: "Create an ephemeral auth key (node auto-deletes when offline)",
        default: false,
      })
      .option("host", {
        type: "string",
        describe: "Hostname to ping (for ping action)",
      })
      .option("json", {
        type: "boolean",
        describe: "Output as JSON",
        default: false,
      })
  },
  async handler(args) {
    const action = args.action ?? "status"

    if (action === "status") {
      // Try local tailscale CLI first
      try {
        const { stdout } = await execAsync("tailscale", ["status"])
        console.log(stdout)
        return
      } catch {
        // fall through to API
      }
      try {
        const data = await tsApi<{ devices: TsDevice[] }>(`/tailnet/${tailnet()}/devices`)
        const online = data.devices.filter((d) => d.online)
        console.log(`Tailscale Status — ${online.length}/${data.devices.length} devices online`)
        for (const d of data.devices) {
          const status = d.online ? "●" : "○"
          const addr = d.addresses[0] ?? "no address"
          console.log(`  ${status} ${d.hostname.padEnd(30)} ${addr.padEnd(16)}  ${d.os}`)
        }
      } catch (err: any) {
        console.error(`Failed to get status: ${err.message}`)
        process.exit(1)
      }
      return
    }

    if (action === "devices") {
      try {
        const data = await tsApi<{ devices: TsDevice[] }>(`/tailnet/${tailnet()}/devices?fields=all`)
        if (args.json) {
          console.log(JSON.stringify(data.devices, null, 2))
          return
        }
        console.log(`Devices on tailnet ${tailnet()}:\n`)
        for (const d of data.devices) {
          const online = d.online ? "online" : "offline"
          const addr = d.addresses.join(", ") || "no address"
          const lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "never"
          console.log(`  ${d.hostname} (${d.name})`)
          console.log(`    Status:    ${online}`)
          console.log(`    OS:        ${d.os}`)
          console.log(`    Addresses: ${addr}`)
          console.log(`    User:      ${d.user}`)
          console.log(`    Last seen: ${lastSeen}`)
          if (d.tags?.length) console.log(`    Tags:      ${d.tags.join(", ")}`)
          console.log()
        }
      } catch (err: any) {
        console.error(`Failed to list devices: ${err.message}`)
        process.exit(1)
      }
      return
    }

    if (action === "auth-key") {
      const tags = (args.tag as string[] | undefined) ?? []
      try {
        const body: Record<string, any> = {
          capabilities: {
            devices: {
              create: {
                reusable: args.reusable,
                ephemeral: args.ephemeral,
                preauthorized: true,
                tags: tags.length > 0 ? tags : undefined,
              },
            },
          },
          expirySeconds: args.expiry,
        }
        const result = await tsApi<{ key: string; id: string; expires: string }>(
          `/tailnet/${tailnet()}/keys`,
          { method: "POST", body: JSON.stringify(body) },
        )
        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`✓ Auth key created`)
          console.log(`  Key:     ${result.key}`)
          console.log(`  ID:      ${result.id}`)
          console.log(`  Expires: ${new Date(result.expires).toLocaleString()}`)
          console.log(`  Options: reusable=${args.reusable}, ephemeral=${args.ephemeral}`)
        }
      } catch (err: any) {
        console.error(`Failed to create auth key: ${err.message}`)
        process.exit(1)
      }
      return
    }

    if (action === "ping") {
      const host = args.host
      if (!host) {
        console.error("Usage: hopcoderx tailscale ping --host <hostname>")
        process.exit(1)
      }
      try {
        const { stdout } = await execAsync("tailscale", ["ping", host])
        console.log(stdout)
      } catch (err: any) {
        console.error(`Ping failed: ${err.message}`)
        console.error("Make sure Tailscale is installed and running locally.")
        process.exit(1)
      }
      return
    }

    if (action === "console") {
      const url = `https://login.tailscale.com/admin/machines`
      console.log(`Opening Tailscale admin console: ${url}`)
      try {
        const { platform } = process
        if (platform === "darwin") await execAsync("open", [url])
        else if (platform === "win32") await execAsync("cmd", ["/c", "start", url])
        else await execAsync("xdg-open", [url])
      } catch {
        console.log(`Visit: ${url}`)
      }
      return
    }
  },
})

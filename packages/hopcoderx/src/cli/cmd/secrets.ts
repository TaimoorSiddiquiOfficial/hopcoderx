/**
 * hopcoderx secrets — encrypted local secrets management.
 *
 * Secrets are stored in ~/.config/hopcoderx/secrets.json, encrypted with
 * AES-256-GCM using a key derived from the machine's hardware ID.
 * They are available to agents via the ${secrets.NAME} interpolation in config.
 *
 * Commands:
 *   hopcoderx secrets set KEY VALUE    — store a secret
 *   hopcoderx secrets get KEY          — retrieve a secret (masked)
 *   hopcoderx secrets delete KEY       — remove a secret
 *   hopcoderx secrets list             — list all secret keys (values hidden)
 *   hopcoderx secrets export           — export all secrets as env var exports
 */

import { cmd } from "./cmd"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import * as prompts from "@clack/prompts"
import path from "path"
import os from "os"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

const SECRETS_FILE = path.join(Global.Path.config, "secrets.enc.json")

// Derive a stable encryption key from machine info
function getMachineKey(): Buffer {
  const id = [
    process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? os.hostname(),
    os.userInfo().username,
    process.env.HOPCODERX_SECRETS_PASSPHRASE ?? "hopcoderx-secrets-v1",
  ].join(":")
  return createHash("sha256").update(id).digest()
}

interface EncryptedStore {
  version: 1
  entries: Array<{ key: string; iv: string; tag: string; data: string }>
}

async function loadStore(): Promise<EncryptedStore> {
  try {
    return await Filesystem.readJson<EncryptedStore>(SECRETS_FILE)
  } catch {
    return { version: 1, entries: [] }
  }
}

async function saveStore(store: EncryptedStore) {
  await Filesystem.write(SECRETS_FILE, JSON.stringify(store, null, 2))
}

function encrypt(value: string, machineKey: Buffer): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", machineKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: encrypted.toString("hex"),
  }
}

function decrypt(entry: { iv: string; tag: string; data: string }, machineKey: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", machineKey, Buffer.from(entry.iv, "hex"))
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"))
  return Buffer.concat([decipher.update(Buffer.from(entry.data, "hex")), decipher.final()]).toString("utf8")
}

function mask(value: string): string {
  if (value.length <= 4) return "****"
  return value.slice(0, 4) + "*".repeat(Math.min(value.length - 4, 20))
}

const SecretsSetCommand = cmd({
  command: "set <key> [value]",
  describe: "store a secret (prompts for value if not provided)",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", describe: "Secret key name", demandOption: true })
      .positional("value", { type: "string", describe: "Secret value (leave empty to prompt securely)" }),
  handler: async (args) => {
    const key = (args.key as string).toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    let value = args.value as string | undefined

    if (!value) {
      const input = await prompts.password({ message: `Value for ${key}:` })
      if (prompts.isCancel(input) || !input) {
        console.log("Cancelled.")
        return
      }
      value = input
    }

    const machineKey = getMachineKey()
    const store = await loadStore()
    const idx = store.entries.findIndex((e) => e.key === key)
    const encrypted = encrypt(value, machineKey)
    const entry = { key, ...encrypted }

    if (idx >= 0) {
      store.entries[idx] = entry
      console.log(`\x1b[33m↑\x1b[0m Secret \x1b[1m${key}\x1b[0m updated`)
    } else {
      store.entries.push(entry)
      console.log(`\x1b[32m+\x1b[0m Secret \x1b[1m${key}\x1b[0m saved`)
    }
    await saveStore(store)
  },
})

const SecretsGetCommand = cmd({
  command: "get <key>",
  describe: "retrieve a secret (value is masked by default)",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", describe: "Secret key name", demandOption: true })
      .option("reveal", { type: "boolean", default: false, describe: "Show the full value" }),
  handler: async (args) => {
    const key = (args.key as string).toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    const store = await loadStore()
    const entry = store.entries.find((e) => e.key === key)
    if (!entry) {
      console.error(`\x1b[31m✗\x1b[0m Secret \x1b[1m${key}\x1b[0m not found`)
      process.exitCode = 1
      return
    }
    const machineKey = getMachineKey()
    const value = decrypt(entry, machineKey)
    console.log(`${key}=${args.reveal ? value : mask(value)}`)
  },
})

const SecretsDeleteCommand = cmd({
  command: "delete <key>",
  aliases: ["rm", "remove"],
  describe: "delete a secret",
  builder: (yargs) =>
    yargs.positional("key", { type: "string", describe: "Secret key name", demandOption: true }),
  handler: async (args) => {
    const key = (args.key as string).toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    const store = await loadStore()
    const before = store.entries.length
    store.entries = store.entries.filter((e) => e.key !== key)
    if (store.entries.length === before) {
      console.error(`\x1b[31m✗\x1b[0m Secret \x1b[1m${key}\x1b[0m not found`)
      process.exitCode = 1
      return
    }
    await saveStore(store)
    console.log(`\x1b[32m✓\x1b[0m Secret \x1b[1m${key}\x1b[0m deleted`)
  },
})

const SecretsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all stored secret keys",
  builder: (yargs) => yargs,
  handler: async () => {
    const store = await loadStore()
    if (store.entries.length === 0) {
      console.log("\x1b[2mNo secrets stored. Use: hopcoderx secrets set KEY VALUE\x1b[0m")
      return
    }
    console.log(`\n\x1b[1mStored secrets\x1b[0m (${store.entries.length})\n`)
    for (const entry of store.entries) {
      console.log(`  \x1b[32m●\x1b[0m \x1b[1m${entry.key}\x1b[0m`)
    }
    console.log()
    console.log(`\x1b[2mStored at: ${SECRETS_FILE}\x1b[0m`)
    console.log(`\x1b[2mUse \x1b[0mhopcoderx secrets get KEY --reveal\x1b[2m to view values\x1b[0m`)
  },
})

const SecretsExportCommand = cmd({
  command: "export",
  describe: "export all secrets as shell export statements",
  builder: (yargs) =>
    yargs.option("format", {
      type: "string",
      choices: ["sh", "dotenv", "json"],
      default: "sh",
      describe: "Output format",
    }),
  handler: async (args) => {
    const store = await loadStore()
    const machineKey = getMachineKey()
    const secrets: Record<string, string> = {}
    for (const entry of store.entries) {
      try {
        secrets[entry.key] = decrypt(entry, machineKey)
      } catch {
        // skip corrupted entries
      }
    }

    if (args.format === "json") {
      console.log(JSON.stringify(secrets, null, 2))
    } else if (args.format === "dotenv") {
      for (const [k, v] of Object.entries(secrets)) console.log(`${k}=${v}`)
    } else {
      for (const [k, v] of Object.entries(secrets)) console.log(`export ${k}="${v.replace(/"/g, '\\"')}"`)
    }
  },
})

export const SecretsCommand = cmd({
  command: "secrets",
  describe: "manage encrypted local secrets",
  builder: (yargs) =>
    yargs
      .command(SecretsSetCommand)
      .command(SecretsGetCommand)
      .command(SecretsDeleteCommand)
      .command(SecretsListCommand)
      .command(SecretsExportCommand)
      .demandCommand(1, "Specify a subcommand: set, get, delete, list, export"),
  handler: () => {},
})

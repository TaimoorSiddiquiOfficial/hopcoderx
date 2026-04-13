#!/usr/bin/env bun
/**
 * Generate man pages for HopCoderX CLI commands
 *
 * Usage: bun run script/generate-manpages.ts
 * Output: packages/hopcoderx/man/*.1
 */

import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { CommandTaxonomy } from "../src/cli/command-taxonomy"
import { Installation } from "../src/installation"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAN_DIR = path.join(__dirname, "..", "man")

function escapeManText(text: string): string {
  return text
    .replace(/\\/g, "\\[u005C]")
    .replace(/-/g, "\\-")
    .replace(/'/g, "\\(aq")
    .replace(/"/g, "\\(dq")
}

function formatSection(title: string, content: string): string {
  return `.SH ${title.toUpperCase()}\n${content}\n`
}

function formatItem(name: string, description: string): string {
  return `.TP\n\\fB${escapeManText(name)}\\fR\n${escapeManText(description)}\n`
}

async function generateMainManpage(): Promise<string> {
  const version = Installation.VERSION

  let content = `.TH HOPCODERX 1 "HopCoderX ${version}"\n`
  content += `.SH NAME\nhopcoderx \\- AI-powered coding assistant\n`
  content += `.SH SYNOPSIS\n.B hopcoderx\n.RI [ options ]\n.RI < command >\n.RI [ arguments ]\n`
  content += `.SH DESCRIPTION\nHopCoderX is an AI-powered coding assistant that helps you write, review, and understand code.\n`
  content += `.SH OPTIONS\n`
  content += formatItem("-v, --version", "Show version number")
  content += formatItem("-h, --help", "Show help")
  content += formatItem("--print-logs", "Print logs to stderr")
  content += formatItem("--log-level", "Set log level (DEBUG, INFO, WARN, ERROR)")

  content += `.SH COMMAND GROUPS\n`
  for (const group of CommandTaxonomy) {
    content += formatItem(group.name, group.title)
  }

  content += `.SH EXAMPLES\n`
  content += `.B hopcoderx run "implement user authentication"\n`
  content += `.B hopcoderx session list\n`
  content += `.B hopcoderx config get model\n`
  content += `.B hopcoderx plugins list\n`

  content += `.SH SEE ALSO\n`
  content += `Full documentation at: https://hopcoder.dev\n`

  return content
}

async function generateCommandManpages(): Promise<void> {
  for (const group of CommandTaxonomy) {
    const version = Installation.VERSION
    let content = `.TH HOPCODERX-${group.name.toUpperCase()} 1 "HopCoderX ${version}"\n`
    content += `.SH NAME\nhopcoderx ${group.name} \\- ${group.title}\n`
    content += `.SH SYNOPSIS\n.B hopcoderx ${group.name}\n.RI < subcommand >\n.RI [ arguments ]\n`
    content += `.SH DESCRIPTION\n${escapeManText(group.title)}\n`
    content += `.SH SUBCOMMANDS\n`

    for (const cmd of group.summary) {
      content += formatItem(cmd, `Run 'hopcoderx ${group.name} ${cmd} --help' for more information`)
    }

    content += `.SH SEE ALSO\n`
    content += `.BR hopcoderx (1)\n`

    await writeFile(path.join(MAN_DIR, `${group.name}.1`), content)
  }
}

async function main() {
  console.log("Generating man pages...")

  // Create man directory
  await mkdir(MAN_DIR, { recursive: true })

  // Generate main manpage
  const mainContent = await generateMainManpage()
  await writeFile(path.join(MAN_DIR, "hopcoderx.1"), mainContent)
  console.log(`  Created: hopcoderx.1`)

  // Generate command group manpages
  await generateCommandManpages()
  for (const group of CommandTaxonomy) {
    console.log(`  Created: ${group.name}.1`)
  }

  console.log(`\nMan pages generated in: ${MAN_DIR}`)
  console.log("\nTo install system-wide:")
  console.log("  sudo cp man/*.1 /usr/share/man/man1/")
  console.log("  sudo mandb")
}

main().catch(console.error)

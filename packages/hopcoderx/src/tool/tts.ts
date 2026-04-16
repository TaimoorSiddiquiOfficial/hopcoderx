/**
 * TTS (Text-to-Speech) output tool — read agent responses aloud.
 *
 * Providers:
 *   1. ElevenLabs — high-quality, natural voices (ELEVENLABS_API_KEY)
 *   2. OpenAI TTS — fast, affordable (OPENAI_API_KEY)
 *   3. System TTS — no API key needed (say/espeak/powershell)
 *
 * Use cases:
 *   - Hear CI results while working
 *   - Accessibility: listen to code reviews
 *   - Eyes-free coding: hear agent responses while reading docs
 *   - Pair programming: audible code feedback
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { Log } from "../util/log"

const execFileAsync = promisify(execFile)
type Meta = Record<string, string | number | boolean | undefined>

async function ttsElevenLabs(text: string, apiKey: string, voiceId = "21m00Tcm4TlvDq8ikWAM"): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 5000), model_id: "eleven_monolingual_v1" }),
  })
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function ttsOpenAI(text: string, apiKey: string, voice = "alloy"): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: text.slice(0, 4096), voice }),
  })
  if (!res.ok) throw new Error(`OpenAI TTS error: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function ttsSystem(text: string): Promise<void> {
  const platform = process.platform
  const safeText = text.replace(/"/g, "'").slice(0, 500)
  if (platform === "darwin") {
    await execFileAsync("say", [safeText])
  } else if (platform === "linux") {
    try { await execFileAsync("espeak", ["-s", "150", safeText]) } catch (e) {
      try { await execFileAsync("festival", ["--tts", safeText]) } catch (e) {
        Log.Default.warn("TTS failed", {
          service: "tts.system",
          platform,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  } else if (platform === "win32") {
    await execFileAsync("powershell", ["-Command", `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak("${safeText}")`])
  }
}

async function playAudio(buffer: Buffer): Promise<void> {
  const outDir = join(tmpdir(), "hopcoderx-tts")
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `tts_${Date.now()}.mp3`)
  await writeFile(outPath, buffer)
  const platform = process.platform
  if (platform === "darwin") await execFileAsync("afplay", [outPath])
  else if (platform === "linux") {
    try { await execFileAsync("mpv", [outPath]) } catch (e) {
      try { await execFileAsync("aplay", [outPath]) } catch (e) {
        Log.Default.warn("audio playback failed", {
          service: "tts.play",
          platform,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  } else if (platform === "win32") {
    await execFileAsync("powershell", ["-Command", `(New-Object Media.SoundPlayer "${outPath}").PlaySync()`])
  }
}

const parameters = z.object({
  text: z.string().describe("Text to speak aloud"),
  provider: z.enum(["auto", "elevenlabs", "openai", "system"]).default("auto").describe("TTS provider"),
  voice: z.string().optional().describe("Voice ID (provider-specific). ElevenLabs: voice ID. OpenAI: alloy/echo/fable/onyx/nova/shimmer"),
  play: z.boolean().default(true).describe("Play audio immediately (requires audio player)"),
})

export const TTSTool = Tool.define<typeof parameters, Meta>("speak", {
  description:
    "Convert text to speech and play it aloud. Use for CI results, accessibility, or eyes-free code review.",
  parameters,
  async execute({ text, provider, voice, play }) {
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    try {
      let providerUsed = provider

      if (provider === "auto" || provider === "elevenlabs") {
        if (elevenLabsKey) {
          const buffer = await ttsElevenLabs(text, elevenLabsKey, voice)
          if (play) await playAudio(buffer)
          providerUsed = "elevenlabs"
          return { title: "speak", output: `🔊 Speaking (${providerUsed}): "${text.slice(0, 60)}…"`, metadata: { provider: providerUsed } as Meta }
        } else if (provider === "elevenlabs") {
          return { title: "speak", output: "ELEVENLABS_API_KEY not set.", metadata: {} as Meta }
        }
      }

      if (provider === "auto" || provider === "openai") {
        if (openaiKey) {
          const buffer = await ttsOpenAI(text, openaiKey, voice ?? "alloy")
          if (play) await playAudio(buffer)
          providerUsed = "openai"
          return { title: "speak", output: `🔊 Speaking (${providerUsed}): "${text.slice(0, 60)}…"`, metadata: { provider: providerUsed } as Meta }
        } else if (provider === "openai") {
          return { title: "speak", output: "OPENAI_API_KEY not set.", metadata: {} as Meta }
        }
      }

      // Fallback: system TTS (no API key needed)
      await ttsSystem(text)
      return { title: "speak", output: `🔊 Speaking (system TTS): "${text.slice(0, 60)}…"`, metadata: { provider: "system" } as Meta }
    } catch (e) {
      return {
        title: "speak",
        output: `TTS failed: ${e instanceof Error ? e.message : e}`,
        metadata: {} as Meta,
      }
    }
  },
})

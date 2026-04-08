/**
 * Voice input tool for HopCoderX.
 *
 * Captures microphone audio and transcribes via Deepgram or OpenAI Whisper.
 *
 * Requires:
 *   DEEPGRAM_API_KEY=xxx   (Deepgram STT, recommended)
 *   or OPENAI_API_KEY=xxx  (OpenAI Whisper fallback)
 *
 * Usage:
 *   voice-input --audio_file <path>   Transcribe an audio file
 *   voice-input                       Capture 5s from microphone (requires sox/arecord/ffmpeg)
 */

import { Tool } from "./tool"
import z from "zod"
import { Log } from "@/util/log"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { join } from "path"

const log = Log.create({ service: "tool.voice" })

const parameters = z.object({
  audio_file: z.string().optional().describe("Path to a WAV/MP3/M4A audio file to transcribe"),
  provider: z.enum(["deepgram", "whisper", "auto"]).optional().default("auto").describe("STT provider"),
  language: z.string().optional().default("en").describe("BCP-47 language code (e.g. en, fr, es, zh)"),
  model: z.string().optional().describe("Provider-specific model name"),
  diarize: z.boolean().optional().default(false).describe("Enable speaker diarization (Deepgram only)"),
  punctuate: z.boolean().optional().default(true).describe("Add punctuation to transcript"),
})

type Meta = Record<string, string | number | boolean | undefined>

async function transcribeDeepgram(
  audioData: Buffer,
  opts: { language: string; model?: string; diarize: boolean; punctuate: boolean; mimeType?: string },
): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error("DEEPGRAM_API_KEY not set")
  const params = new URLSearchParams({
    model: opts.model ?? "nova-2",
    language: opts.language,
    punctuate: String(opts.punctuate),
    diarize: String(opts.diarize),
    smart_format: "true",
  })
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": opts.mimeType ?? "audio/wav" },
    body: audioData.buffer as ArrayBuffer,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Deepgram error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } }
  return (data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim()
}

async function transcribeWhisper(
  audioData: Buffer,
  fileName: string,
  opts: { language: string; model?: string },
): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error("OPENAI_API_KEY not set")
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "wav"
  const mimeMap: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac" }
  const mime = mimeMap[ext] ?? "audio/wav"
  const form = new FormData()
  form.append("file", new Blob([audioData.buffer as ArrayBuffer], { type: mime }), fileName)
  form.append("model", opts.model ?? "whisper-1")
  form.append("language", opts.language)
  form.append("response_format", "text")
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Whisper error ${res.status}: ${await res.text()}`)
  return (await res.text()).trim()
}

async function captureMicrophone(durationMs = 5000): Promise<Buffer> {
  const { platform } = process
  const tmpFile = join(tmpdir(), `hopcoderx-voice-${Date.now()}.wav`)
  let captureCmd: string[]
  if (platform === "darwin") {
    captureCmd = ["sox", "-d", "-r", "16000", "-c", "1", "-b", "16", tmpFile, "trim", "0", String(durationMs / 1000)]
  } else if (platform === "linux") {
    captureCmd = ["arecord", "-r", "16000", "-c", "1", "-f", "S16_LE", "-d", String(Math.ceil(durationMs / 1000)), tmpFile]
  } else {
    captureCmd = ["ffmpeg", "-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", "-t", String(durationMs / 1000), "-y", tmpFile]
  }
  const proc = spawnSync(captureCmd[0], captureCmd.slice(1), { timeout: durationMs + 5000, stdio: "inherit" })
  if (proc.status !== 0) throw new Error(`Audio capture failed: exit code ${proc.status}`)
  const buf = await readFile(tmpFile)
  import("fs/promises").then((fs) => fs.unlink(tmpFile)).catch(() => {})
  return buf
}

export const VoiceInputTool = Tool.define<typeof parameters, Meta>("voice-input", {
  description: "Transcribe speech to text from a microphone or audio file. Supports Deepgram (nova-2) and OpenAI Whisper.",
  parameters,
  async execute(params) {
    let audioData: Buffer
    let fileName = "audio.wav"

    if (params.audio_file) {
      if (!existsSync(params.audio_file)) {
        return { title: "Voice input: file not found", metadata: {} as Meta, output: `Audio file not found: ${params.audio_file}` }
      }
      audioData = await readFile(params.audio_file)
      fileName = params.audio_file.split(/[\\/]/).pop() ?? "audio.wav"
      log.info("voice: transcribing file", { file: params.audio_file })
    } else {
      log.info("voice: capturing microphone audio")
      try {
        audioData = await captureMicrophone(5000)
        fileName = "mic-capture.wav"
      } catch (err: any) {
        return {
          title: "Voice input: microphone capture failed",
          metadata: {} as Meta,
          output: [
            `Failed to capture microphone: ${err.message}`,
            "",
            "Ensure one of the following is installed:",
            "  macOS/Linux: sox   (brew install sox / apt install sox)",
            "  Linux:       arecord (apt install alsa-utils)",
            "  Windows:     ffmpeg (https://ffmpeg.org)",
            "",
            "Or provide an audio file: voice-input --audio_file <path>",
          ].join("\n"),
        }
      }
    }

    let provider = params.provider
    if (provider === "auto") {
      provider = process.env.DEEPGRAM_API_KEY ? "deepgram" : process.env.OPENAI_API_KEY ? "whisper" : "deepgram"
    }

    let transcript: string
    try {
      if (provider === "deepgram") {
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "wav"
        const mimeMap: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm" }
        transcript = await transcribeDeepgram(audioData!, { language: params.language, model: params.model, diarize: params.diarize, punctuate: params.punctuate, mimeType: mimeMap[ext] })
      } else {
        transcript = await transcribeWhisper(audioData!, fileName, { language: params.language, model: params.model })
      }
    } catch (err: any) {
      log.error("voice: transcription failed", { error: err.message })
      return { title: "Voice input: transcription failed", metadata: { provider, error: err.message } as Meta, output: `Transcription failed (${provider}): ${err.message}` }
    }

    if (!transcript) {
      return { title: "Voice input: no speech detected", metadata: { provider } as Meta, output: "No speech detected in the audio." }
    }

    log.info("voice: transcript ready", { length: transcript.length })
    return {
      title: "Voice input transcript",
      metadata: { provider, language: params.language, wordCount: transcript.split(/\s+/).length } as Meta,
      output: transcript,
    }
  },
})
/**
 * Audio transcription tool — convert audio to text using Deepgram or Whisper.
 *
 * Use cases:
 *   - Transcribe meeting recordings → action items + code tasks
 *   - Voice commands in terminal (paired with mic input)
 *   - Convert spoken requirements to implementation plans
 *
 * Providers:
 *   1. Deepgram (streaming-capable, fastest)
 *   2. OpenAI Whisper API (via openai package)
 *   3. Local Whisper (via `whisper` CLI)
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import { extname, basename } from "path"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)
type Meta = Record<string, string | number | boolean | undefined>

async function transcribeWithWhisperCLI(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync("whisper", [filePath, "--output_format", "txt", "--output_dir", "/tmp"])
  return stdout.trim()
}

async function transcribeWithOpenAIWhisper(filePath: string, apiKey: string, language?: string): Promise<string> {
  const buffer = await readFile(filePath)
  const ext = extname(filePath).replace(".", "")
  const mime = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mpeg"

  const formData = new FormData()
  formData.append("file", new Blob([buffer.buffer as ArrayBuffer], { type: mime }), basename(filePath))
  formData.append("model", "whisper-1")
  if (language) formData.append("language", language)

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })
  if (!res.ok) throw new Error(`Whisper API error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { text: string }
  return data.text
}

async function transcribeWithDeepgram(filePath: string, apiKey: string, language?: string): Promise<string> {
  const buffer = await readFile(filePath)
  const ext = extname(filePath).replace(".", "").toLowerCase()
  const mimeMap: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", ogg: "audio/ogg" }
  const mime = mimeMap[ext] ?? "audio/mpeg"

  const langParam = language ? `&language=${encodeURIComponent(language)}` : ""
  const res = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true${langParam}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": mime },
    body: buffer.buffer as ArrayBuffer,
  })
  if (!res.ok) throw new Error(`Deepgram error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as any
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "(empty transcript)"
}

const parameters = z.object({
  file: z.string().describe("Path to audio file (mp3, wav, flac, m4a, ogg)"),
  provider: z
    .enum(["auto", "deepgram", "openai-whisper", "local-whisper"])
    .default("auto")
    .describe("Transcription provider"),
  language: z.string().optional().describe("Language code (e.g. 'en', 'es', 'fr'). Auto-detected if omitted."),
})

export const AudioTranscriptionTool = Tool.define<typeof parameters, Meta>("transcribe", {
  description:
    "Transcribe audio files (MP3, WAV, FLAC, M4A) to text using Deepgram or OpenAI Whisper. Useful for meeting notes, voice commands, spoken requirements.",
  parameters,
  async execute({ file, provider, language }) {
    if (!existsSync(file)) {
      return { title: "transcribe", output: `File not found: ${file}`, metadata: {} as Meta }
    }

    const deepgramKey = process.env.DEEPGRAM_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    try {
      let transcript = ""
      let providerUsed = provider

      if (provider === "auto" || provider === "deepgram") {
        if (deepgramKey) {
          transcript = await transcribeWithDeepgram(file, deepgramKey, language)
          providerUsed = "deepgram"
        } else if (provider === "deepgram") {
          return { title: "transcribe", output: "DEEPGRAM_API_KEY not set.", metadata: {} as Meta }
        }
      }

      if (!transcript && (provider === "auto" || provider === "openai-whisper")) {
        if (openaiKey) {
          transcript = await transcribeWithOpenAIWhisper(file, openaiKey, language)
          providerUsed = "openai-whisper"
        } else if (provider === "openai-whisper") {
          return { title: "transcribe", output: "OPENAI_API_KEY not set.", metadata: {} as Meta }
        }
      }

      if (!transcript && (provider === "auto" || provider === "local-whisper")) {
        transcript = await transcribeWithWhisperCLI(file)
        providerUsed = "local-whisper"
      }

      if (!transcript) {
        return {
          title: "transcribe",
          output: "No transcription provider available. Set DEEPGRAM_API_KEY or OPENAI_API_KEY, or install the `whisper` CLI.",
          metadata: {} as Meta,
        }
      }

      return {
        title: "transcribe",
        output: `Transcript (${providerUsed}):\n\n${transcript}`,
        metadata: { file, provider: providerUsed, chars: transcript.length } as Meta,
      }
    } catch (e) {
      return {
        title: "transcribe",
        output: `Transcription failed: ${e instanceof Error ? e.message : e}`,
        metadata: {} as Meta,
      }
    }
  },
})

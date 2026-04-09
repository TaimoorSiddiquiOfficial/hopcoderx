/**
 * Voice pipeline for HopCoderX — STT + TTS via REST APIs.
 *
 * Provides two capabilities without heavy native dependencies:
 *
 * 1. Speech-to-Text (STT) via Deepgram Nova-3
 *    Env: DEEPGRAM_API_KEY
 *
 * 2. Text-to-Speech (TTS) via ElevenLabs
 *    Env: ELEVENLABS_API_KEY
 *    Optional: ELEVENLABS_VOICE_ID (default: "Rachel" preset)
 *
 * Design: pure REST calls — no native bindings, Bun-safe.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscribeOptions {
  /** Language hint (BCP-47, e.g. "en", "ar", "fr"). Auto-detected if omitted. */
  language?: string
  /** Model to use (default: "nova-3") */
  model?: string
  /** Whether to include word-level timestamps */
  timestamps?: boolean
}

export interface TranscribeResult {
  /** Full transcript text */
  text: string
  /** Confidence score 0–1 */
  confidence: number
  /** Word-level segments (if timestamps requested) */
  words?: Array<{ word: string; start: number; end: number; confidence: number }>
  /** Detected language code */
  detectedLanguage?: string
  /** Raw Deepgram response */
  raw?: unknown
}

export interface SynthesizeOptions {
  /** ElevenLabs voice ID (overrides ELEVENLABS_VOICE_ID) */
  voiceId?: string
  /** Model to use (default: "eleven_multilingual_v2") */
  modelId?: string
  /** Voice stability 0–1 (default: 0.5) */
  stability?: number
  /** Similarity boost 0–1 (default: 0.75) */
  similarityBoost?: number
  /** Output format: "mp3_44100_128" | "pcm_16000" | "pcm_22050" (default: "mp3_44100_128") */
  outputFormat?: string
}

export interface SynthesizeResult {
  /** Audio data as a Buffer */
  audio: Buffer
  /** MIME type (e.g. "audio/mpeg") */
  mimeType: string
  /** Output format string */
  format: string
}

// ─── Deepgram STT ────────────────────────────────────────────────────────────

const DEEPGRAM_API = "https://api.deepgram.com/v1"

/**
 * Transcribe audio to text via Deepgram Nova.
 *
 * @param audio  Audio data as Buffer or ArrayBuffer. Supports: mp3, ogg, wav, m4a, webm, etc.
 * @param opts   Transcription options
 */
export async function transcribe(
  audio: Buffer | ArrayBuffer | Uint8Array,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error("Voice/STT: DEEPGRAM_API_KEY is not set")

  const model = opts.model ?? "nova-3"
  const params = new URLSearchParams({ model, smart_format: "true" })
  if (opts.language) params.set("language", opts.language)
  if (opts.timestamps) params.set("timestamps", "true")

  const body = audio instanceof Buffer ? audio : Buffer.from(audio)

  const res = await fetch(`${DEEPGRAM_API}/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "audio/*",
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Deepgram error ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string
          confidence?: number
          words?: Array<{ word: string; start: number; end: number; confidence: number }>
        }>
        detected_language?: string
      }>
    }
    metadata?: unknown
  }

  const channel = data.results?.channels?.[0]
  const alt = channel?.alternatives?.[0]
  return {
    text: alt?.transcript ?? "",
    confidence: alt?.confidence ?? 0,
    words: alt?.words,
    detectedLanguage: channel?.detected_language,
    raw: data,
  }
}

// ─── ElevenLabs TTS ──────────────────────────────────────────────────────────

const ELEVENLABS_API = "https://api.elevenlabs.io/v1"
// ElevenLabs preset "Rachel" — neutral female English voice
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"

const FORMAT_MIME: Record<string, string> = {
  mp3_44100_128: "audio/mpeg",
  mp3_22050_32: "audio/mpeg",
  pcm_16000: "audio/pcm",
  pcm_22050: "audio/pcm",
  pcm_44100: "audio/pcm",
  ulaw_8000: "audio/basic",
}

/**
 * Synthesize text to speech via ElevenLabs.
 *
 * @param text  The text to speak (max ~5000 chars per request)
 * @param opts  Voice and output options
 */
export async function synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesizeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("Voice/TTS: ELEVENLABS_API_KEY is not set")

  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const modelId = opts.modelId ?? "eleven_multilingual_v2"
  const outputFormat = opts.outputFormat ?? "mp3_44100_128"

  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`ElevenLabs error ${res.status}: ${errText}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return {
    audio: Buffer.from(arrayBuffer),
    mimeType: FORMAT_MIME[outputFormat] ?? "audio/mpeg",
    format: outputFormat,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** List available ElevenLabs voices for the configured account */
export async function listVoices(): Promise<Array<{ voice_id: string; name: string; category: string }>> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error("Voice/TTS: ELEVENLABS_API_KEY is not set")
  const res = await fetch(`${ELEVENLABS_API}/voices`, { headers: { "xi-api-key": apiKey } })
  if (!res.ok) throw new Error(`ElevenLabs error ${res.status}`)
  const data = await res.json() as { voices: Array<{ voice_id: string; name: string; category: string }> }
  return data.voices
}

/** Diagnose voice pipeline configuration */
export async function diagnoseVoice(): Promise<{
  ok: boolean
  stt: { ok: boolean; detail: string }
  tts: { ok: boolean; detail: string }
}> {
  const sttKey = !!process.env.DEEPGRAM_API_KEY
  const ttsKey = !!process.env.ELEVENLABS_API_KEY

  let sttDetail = sttKey ? "DEEPGRAM_API_KEY set" : "DEEPGRAM_API_KEY missing"
  let ttsDetail = ttsKey ? "ELEVENLABS_API_KEY set" : "ELEVENLABS_API_KEY missing"

  // Lightweight connectivity check for Deepgram (GET /projects — just checks auth)
  if (sttKey) {
    try {
      const res = await fetch(`${DEEPGRAM_API}/projects`, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
      })
      sttDetail = res.ok ? "Connected (Deepgram)" : `Auth failed (${res.status})`
    } catch {
      sttDetail = "Connection error (Deepgram)"
    }
  }

  // Lightweight connectivity check for ElevenLabs (GET /user)
  if (ttsKey) {
    try {
      const res = await fetch(`${ELEVENLABS_API}/user`, {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      })
      if (res.ok) {
        const data = await res.json() as { subscription?: { tier?: string } }
        ttsDetail = `Connected — tier: ${data.subscription?.tier ?? "unknown"}`
      } else {
        ttsDetail = `Auth failed (${res.status})`
      }
    } catch {
      ttsDetail = "Connection error (ElevenLabs)"
    }
  }

  return {
    ok: sttKey && ttsKey,
    stt: { ok: sttKey, detail: sttDetail },
    tts: { ok: ttsKey, detail: ttsDetail },
  }
}

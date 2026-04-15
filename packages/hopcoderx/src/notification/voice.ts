/**
 * Voice/TTS Notifications
 *
 * Text-to-speech notifications using various engines:
 * - Azure Cognitive Services (premium, natural voices)
 * - Google Cloud TTS (high quality)
 * - Local/system TTS (no API key required)
 *
 * Usage:
 *   await sendVoiceNotification({
 *     title: "Build Complete",
 *     message: "Your code compiled successfully",
 *     type: "success"
 *   }, {
 *     type: "voice",
 *     engine: "local"
 *   })
 */

import type { NotificationManager } from "./index"
type Notification = NotificationManager.Notification
type VoiceChannel = NotificationManager.VoiceChannel
import { Log } from "@/util/log"
import { execFile } from "child_process"
import { promisify } from "util"
import os from "os"

const execFileAsync = promisify(execFile)
const log = Log.create({ service: "notification.voice" })

export async function sendVoiceNotification(notification: Notification, channel: VoiceChannel): Promise<void> {
  const { title, message, type } = notification
  const engine = channel.engine ?? "local"

  // Compose speech text
  const speechText = composeSpeechText(title, message, type)

  switch (engine) {
    case "azure":
      await sendAzureTTS(speechText, channel)
      break
    case "google":
      await sendGoogleTTS(speechText, channel)
      break
    case "local":
    default:
      await sendLocalTTS(speechText, channel)
      break
  }
}

/**
 * Compose speech text from notification
 */
function composeSpeechText(title: string, message: string, type: string): string {
  // Add appropriate tone based on type
  const intros: Record<string, string> = {
    info: "Notification:",
    success: "Good news!",
    warning: "Warning:",
    error: "Alert:",
  }

  const intro = intros[type] || intros.info
  return `${intro} ${title}. ${message}`
}

/**
 * Local/System TTS - uses built-in OS text-to-speech
 */
async function sendLocalTTS(text: string, channel: VoiceChannel): Promise<void> {
  const platform = os.platform()
  const voice = channel.voice
  const rate = channel.rate || 1.0

  try {
    if (platform === "darwin") {
      // macOS - use say command
      const args: string[] = []

      if (voice) {
        args.push("-v", voice)
      }

      // Adjust rate (macOS uses words per minute, default ~220)
      if (rate !== 1.0) {
        const wpm = Math.round(220 * rate)
        args.push("-r", wpm.toString())
      }

      args.push(text)

      await execFileAsync("say", args, {
        timeout: 30000,
      })

      log.info("macos TTS notification spoken", { text: text.slice(0, 50) })
    } else if (platform === "win32") {
      // Windows - use PowerShell SAPI
      const escapedText = text.replace(/"/g, '`"').replace(/'/g, "`'")

      const script = `
Add-Type -AssemblyName System.Speech
$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speak.Speak("${escapedText}")
`

      await execFileAsync("powershell", ["-Command", script], {
        timeout: 30000,
        windowsHide: true,
      })

      log.info("windows TTS notification spoken", { text: text.slice(0, 50) })
    } else {
      // Linux - try espeak or festival
      const args = ["-s", Math.round(175 * rate).toString(), text]

      try {
        await execFileAsync("espeak", args, {
          timeout: 30000,
        })
        log.info("linux TTS notification spoken (espeak)", { text: text.slice(0, 50) })
      } catch (espeakError) {
        // Try festival as fallback
        try {
          const { exec } = await import("child_process")
          const execAsync = promisify(exec)
          await execAsync(`echo "${text.replace(/"/g, '\\"')}" | festival --tts`, {
            timeout: 30000,
          })
          log.info("linux TTS notification spoken (festival)", { text: text.slice(0, 50) })
        } catch (festivalError) {
          log.warn("no TTS engine available on linux", {
            espeakError,
            festivalError,
          })
          throw new Error("No TTS engine available. Install espeak or festival.")
        }
      }
    }
  } catch (error) {
    log.error("local TTS notification failed", { error, platform })
    throw error
  }
}

/**
 * Azure Cognitive Services TTS
 * Requires: AZURE_TTS_KEY and AZURE_TTS_REGION environment variables
 */
async function sendAzureTTS(text: string, channel: VoiceChannel): Promise<void> {
  const apiKey = process.env.AZURE_TTS_KEY
  const region = process.env.AZURE_TTS_REGION || "eastus"
  const voice = channel.voice || "en-US-JennyNeural"

  if (!apiKey) {
    throw new Error("Azure TTS requires AZURE_TTS_KEY environment variable")
  }

  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`

  // SSML for better speech quality
  const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="${voice}" xml:lang="en-US">
    <prosody rate="${channel.rate || 1.0}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>
`

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: ssml,
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Azure TTS error: ${response.status} - ${errorText}`)
    }

    // Get audio buffer and play it
    const audioBuffer = await response.arrayBuffer()

    // Play audio using platform-specific player
    await playAudioBuffer(Buffer.from(audioBuffer))

    log.info("azure TTS notification spoken", { voice, text: text.slice(0, 50) })
  } catch (error) {
    log.error("azure TTS notification failed", { error })
    throw error
  }
}

/**
 * Google Cloud TTS
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_TTS_KEY environment variable
 */
async function sendGoogleTTS(text: string, channel: VoiceChannel): Promise<void> {
  const apiKey = process.env.GOOGLE_TTS_KEY
  const voice = channel.voice || "en-US-Standard-C"

  if (!apiKey) {
    throw new Error("Google TTS requires GOOGLE_TTS_KEY environment variable")
  }

  const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`

  const body = {
    input: {
      text: text,
    },
    voice: {
      languageCode: "en-US",
      name: voice,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: channel.rate || 1.0,
    },
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google TTS error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as { audioContent: string }

    // Decode base64 audio and play
    const audioBuffer = Buffer.from(data.audioContent, "base64")
    await playAudioBuffer(audioBuffer)

    log.info("google TTS notification spoken", { voice, text: text.slice(0, 50) })
  } catch (error) {
    log.error("google TTS notification failed", { error })
    throw error
  }
}

/**
 * Play audio buffer using platform-specific player
 */
async function playAudioBuffer(buffer: Buffer): Promise<void> {
  const platform = os.platform()

  if (platform === "darwin") {
    // macOS - use afplay
    const tmpFile = `/tmp/hopcoderx-tts-${Date.now()}.mp3`
    const { writeFile } = await import("fs/promises")
    await writeFile(tmpFile, buffer)

    try {
      await execFileAsync("afplay", [tmpFile], {
        timeout: 30000,
      })
    } finally {
      const { unlink } = await import("fs/promises")
      await unlink(tmpFile).catch(() => {})
    }
  } else if (platform === "win32") {
    // Windows - use PowerShell MediaPlayer
    const tmpFile = `C:\\temp\\hopcoderx-tts-${Date.now()}.mp3`
    const { writeFile } = await import("fs/promises")
    const { mkdir } = await import("fs/promises")

    await mkdir("C:\\temp", { recursive: true }).catch(() => {})
    await writeFile(tmpFile, buffer)

    const script = `
Add-Type -AssemblyName System.Speech
$player = New-Object System.Media.SoundPlayer("${tmpFile}")
$player.PlaySync()
`

    await execFileAsync("powershell", ["-Command", script], {
      timeout: 30000,
      windowsHide: true,
    })
  } else {
    // Linux - try aplay or paplay
    const tmpFile = `/tmp/hopcoderx-tts-${Date.now()}.wav`
    const { writeFile } = await import("fs/promises")
    await writeFile(tmpFile, buffer)

    try {
      await execFileAsync("aplay", [tmpFile], {
        timeout: 30000,
      })
    } catch (aplayError) {
      try {
        await execFileAsync("paplay", [tmpFile], {
          timeout: 30000,
        })
      } catch (paplayError) {
        log.warn("no audio player available", { aplayError, paplayError })
      }
    } finally {
      const { unlink } = await import("fs/promises")
      await unlink(tmpFile).catch(() => {})
    }
  }
}

/**
 * Escape special characters for XML/SSML
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Get available system voices (macOS only for now)
 */
export async function getAvailableVoices(): Promise<string[]> {
  const platform = os.platform()

  if (platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("say", ["-v", "?"], {
        timeout: 5000,
      })

      // Parse output format: "VoiceName Language"
      const voices = stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/\s+/)[0])
        .filter(Boolean)

      return voices
    } catch (error) {
      log.error("failed to get available voices", { error })
      return []
    }
  }

  return []
}

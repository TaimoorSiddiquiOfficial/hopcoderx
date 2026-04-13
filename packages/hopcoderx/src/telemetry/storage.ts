import { writeFile, readFile, mkdir } from "fs/promises"
import { Global } from "../global"
import path from "path"

export interface TelemetryEvent {
  event: string
  timestamp: string
  properties?: Record<string, unknown>
}

const TELEMETRY_FILE = () => path.join(Global.Path.data, "telemetry.json")

/**
 * Store a telemetry event to disk
 * Events are stored in a rolling buffer of 1000 events
 */
export async function storeTelemetryEvent(event: TelemetryEvent): Promise<void> {
  await mkdir(Global.Path.data, { recursive: true })

  let events: TelemetryEvent[] = []
  try {
    const content = await readFile(TELEMETRY_FILE(), "utf8")
    events = JSON.parse(content)
  } catch {
    // File doesn't exist yet
  }

  events.push(event)

  // Keep only last 1000 events
  if (events.length > 1000) {
    events = events.slice(-1000)
  }

  await writeFile(TELEMETRY_FILE(), JSON.stringify(events, null, 2))
}

/**
 * Get all stored telemetry events
 */
export async function getTelemetryData(): Promise<TelemetryEvent[]> {
  try {
    const content = await readFile(TELEMETRY_FILE(), "utf8")
    return JSON.parse(content)
  } catch {
    return []
  }
}

/**
 * Clear all stored telemetry data
 */
export async function clearTelemetryData(): Promise<void> {
  await mkdir(Global.Path.data, { recursive: true })
  await writeFile(TELEMETRY_FILE(), "[]")
}

import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const Event = {
  Connected: BusEvent.define("server.connected", z.object({})),
  Disposed: BusEvent.define("global.disposed", z.object({})),
  ContextUpdated: BusEvent.define("context.updated", z.object({
    enabled: z.boolean(),
    loadedFiles: z.array(z.string()),
    totalTokens: z.number(),
    maxTokens: z.number(),
    utilizationPercent: z.number(),
  })),
}

export * from "./client.js"
export * from "./server.js"

import { createHopCoderXClient } from "./client.js"
import { createHopCoderXServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createHopCoderX(options?: ServerOptions) {
  const server = await createHopCoderXServer({
    ...options,
  })

  const client = createHopCoderXClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { HopCoderXClient } from "./gen/sdk.gen.js"
export { type Config as HopCoderXClientConfig, HopCoderXClient }

export function createHopCoderXClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-hopcoderx-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  return new HopCoderXClient({ client })
}

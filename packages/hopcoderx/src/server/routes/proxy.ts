import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { lazy } from "../../util/lazy"

export const ProxyRoutes = lazy(() =>
  new Hono().all("/*", async (c) => {
    const path = c.req.path

    const response = await proxy(`https://app.hopcoderx.dev${path}`, {
      ...c.req,
      headers: {
        ...c.req.raw.headers,
        host: "app.hopcoderx.dev",
      },
    })
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:",
    )
    return response
  }),
)

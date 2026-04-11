import { defineConfig } from "@solidjs/start/config"
import { nitro } from "nitro/vite"

export default defineConfig({
  middleware: "./src/middleware.ts",
  vite: {
    plugins: [
      nitro({
        compatibilityDate: "2024-09-19",
        preset: "cloudflare_module",
        cloudflare: {
          nodeCompat: true,
        },
      }),
    ],
    server: {
      allowedHosts: true,
    },
    build: {
      rollupOptions: {
        external: ["cloudflare:workers"],
      },
      minify: false,
    },
  },
})

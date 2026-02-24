import type { Plugin } from "@hopcoderx/plugin"

/**
 * HopCoderX Anthropic Auth Plugin
 *
 * Provides Anthropic API key authentication for HopCoderX.
 * Set ANTHROPIC_API_KEY environment variable or use the built-in
 * auth prompt to store the key persistently.
 */
export const anthropicAuthPlugin: Plugin = async () => ({
  auth: {
    provider: "anthropic",
    async loader(auth) {
      // Prefer stored auth, fallback to env var
      const authData = await auth()
      const storedKey = (authData?.type === "api" || authData?.type === "wellknown") ? authData.key : undefined
      const key = storedKey ?? process.env.ANTHROPIC_API_KEY
      if (!key) return {}
      return { apiKey: key }
    },
    methods: [
      {
        type: "api",
        label: "Anthropic API Key",
        prompts: [
          {
            type: "text",
            key: "key",
            message: "Anthropic API key",
            placeholder: "sk-ant-...",
            validate: (v) => {
              if (!v) return "API key is required"
              if (!v.startsWith("sk-ant-")) return "Anthropic API keys start with sk-ant-"
              return undefined
            },
          },
        ],
        async authorize(inputs) {
          const key = inputs?.key
          if (!key) return { type: "failed" }
          return { type: "success", key, provider: "anthropic" }
        },
      },
    ],
  },
})

export default anthropicAuthPlugin

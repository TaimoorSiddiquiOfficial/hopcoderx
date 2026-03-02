import type { Hooks, PluginInput } from "@hopcoderx/plugin"

export async function BdrAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "hopcoderx-bdr",
      methods: [
        {
          label: "API Key",
          type: "api",
        },
      ],
    },
  }
}

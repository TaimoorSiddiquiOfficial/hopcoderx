import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const DEFAULT_BASE_URL = 'https://bdr.hopcoder.dev/v1';

/**
 * Create a HopCoderX BDR provider instance for use with the Vercel AI SDK.
 *
 * @param apiKey  - The user's BDR API key (hx_... from the dashboard)
 * @param baseURL - Optional gateway URL (defaults to https://bdr.hopcoder.dev/v1)
 *
 * @example
 * ```ts
 * import { createZenProvider } from '@hopcoderx/bdr-provider'
 *
 * const bdr = createZenProvider('hx_your_api_key')
 * const model = bdr('openai/gpt-4o-mini')
 * ```
 */
export function createZenProvider(apiKey: string, baseURL = DEFAULT_BASE_URL) {
  return createOpenAICompatible({
    name: 'hopcoderx-bdr',
    baseURL,
    headers: {
      'x-hopcoderx-key': apiKey,
    },
  });
}

/**
 * Utility: Fetch available models from the gateway
 * This can be used to populate the models list dynamically
 */
export async function fetchBdrModels(apiKey: string) {
  const response = await fetch('https://bdr.hopcoder.dev/v1/models', {
    headers: {
      'x-hopcoderx-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  return response.json();
}

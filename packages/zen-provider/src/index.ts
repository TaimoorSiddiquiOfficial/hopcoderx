import { createOpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createProvider, generateId } from '@hopcoderx/sdk';

/**
 * HopCoderX Provider
 *
 * This provider connects HopCoderX CLI to your self-hosted BDR gateway.
 * Users need to obtain an API key from the web dashboard at /login
 */
export const zenProvider = createProvider({
  id: 'hopcoderx-bdr',
  name: 'HopCoderX BDR',
  description: 'Self-hosted AI gateway with curated models, billing, and usage tracking',
  
  // Models will be dynamically fetched from your gateway /v1/models endpoint
  // Using a placeholder list that will be replaced at runtime
  models: [
    // These are example models - users see actual available models from /v1/models
    { id: 'openai/gpt-4o-mini', providerID: 'hopcoderx-bdr', name: 'GPT-4o Mini (example)' },
    { id: 'anthropic/claude-3-5-sonnet', providerID: 'hopcoderx-bdr', name: 'Claude 3.5 Sonnet (example)' },
  ],

  async connect({ apiKey }) {
    // apiKey is the user's HopCoderX BDR API key (from dashboard)
    // Validate by fetching models from our gateway
    try {
      const response = await fetch('https://bdr.hopcoder.dev/v1/models', {
        headers: {
          'x-hopcoderx-key': apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Connection failed: ${response.status}`);
      }

      const data = await response.json();
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid gateway response');
      }

      return { apiKey };
    } catch (error) {
      throw new Error(`Failed to connect to HopCoderX Zen: ${error}`);
    }
  },

  async chat({ model, messages, options }) {
    // Forward request to your gateway
    const gatewayUrl = 'https://zen.hopcoder.dev/v1/chat/completions';

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hopcoderx-key': options.apiKey, // User's gateway API key
      },
      body: JSON.stringify({
        model,
        messages,
        ...options, // Pass temperature, max_tokens, etc.
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Gateway error ${response.status}: ${error.error || response.statusText}`);
    }

    return response.json();
  },
});

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

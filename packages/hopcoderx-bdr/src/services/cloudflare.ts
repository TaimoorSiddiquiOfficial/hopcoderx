interface CloudflareEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_GATEWAY_ID: string;
  CLOUDFLARE_GATEWAY_TOKEN: string;
}

/**
 * Forward request to Cloudflare AI Gateway (OpenRouter provider)
 */
export async function forwardToCloudflare(
  env: CloudflareEnv,
  model: string,
  messages: any[],
  openRouterApiKey: string
): Promise<Response> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}/openrouter/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CLOUDFLARE_GATEWAY_TOKEN}`,
      'Authorization': `Bearer ${openRouterApiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  return response;
}

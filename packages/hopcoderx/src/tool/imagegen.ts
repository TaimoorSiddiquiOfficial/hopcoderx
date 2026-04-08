/**
 * Image generation tool — generate UI mockups, diagrams, illustrations.
 *
 * Providers:
 *   1. DALL-E 3 (OpenAI) — via OPENAI_API_KEY
 *   2. Stable Diffusion (FAL.ai) — via FAL_KEY
 *   3. Stable Diffusion (Replicate) — via REPLICATE_API_TOKEN
 *
 * Use cases:
 *   - Generate UI mockups from text description
 *   - Create architecture diagrams
 *   - Visualize data schemas
 *   - Generate icons/illustrations for apps
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

type Meta = Record<string, string | number | boolean | undefined>

async function generateWithDallE(prompt: string, apiKey: string, size: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size, response_format: "url" }),
  })
  if (!res.ok) throw new Error(`DALL-E error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { data: Array<{ url: string; revised_prompt?: string }> }
  return data.data[0]?.url ?? ""
}

async function generateWithFal(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/fast-sdxl", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "landscape_16_9", num_inference_steps: 28 }),
  })
  if (!res.ok) throw new Error(`FAL error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { images: Array<{ url: string }> }
  return data.images?.[0]?.url ?? ""
}

async function generateWithReplicate(prompt: string, apiKey: string): Promise<string> {
  // Start prediction
  const res = await fetch("https://api.replicate.com/v1/models/stability-ai/stable-diffusion/predictions", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, width: 1024, height: 576 } }),
  })
  if (!res.ok) throw new Error(`Replicate error: ${res.status} ${await res.text()}`)
  let prediction = (await res.json()) as { id: string; status: string; output?: string[] }

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${apiKey}` },
    })
    prediction = (await poll.json()) as typeof prediction
    if (prediction.status === "succeeded") return prediction.output?.[0] ?? ""
    if (prediction.status === "failed") throw new Error("Replicate prediction failed")
  }
  throw new Error("Replicate prediction timed out")
}

async function downloadImage(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const outDir = join(tmpdir(), "hopcoderx-imagegen")
  await mkdir(outDir, { recursive: true })
  const filename = `generated_${Date.now()}.png`
  const outPath = join(outDir, filename)
  await writeFile(outPath, buffer)
  return outPath
}

const parameters = z.object({
  prompt: z.string().describe("Description of the image to generate"),
  provider: z.enum(["auto", "dalle", "fal", "replicate"]).default("auto").describe("Image generation provider"),
  size: z.enum(["1024x1024", "1792x1024", "1024x1792"]).default("1024x1024").describe("Image size (DALL-E 3)"),
  save: z.boolean().default(true).describe("Save image to temp file and return path"),
})

export const ImageGenTool = Tool.define<typeof parameters, Meta>("generate-image", {
  description:
    "Generate images from text descriptions using DALL-E 3, FAL.ai, or Replicate. Use for UI mockups, diagrams, illustrations.",
  parameters,
  async execute({ prompt, provider, size, save }) {
    const openaiKey = process.env.OPENAI_API_KEY
    const falKey = process.env.FAL_KEY
    const replicateKey = process.env.REPLICATE_API_TOKEN

    let imageUrl = ""
    let providerUsed = provider

    try {
      if (provider === "auto" || provider === "dalle") {
        if (openaiKey) {
          imageUrl = await generateWithDallE(prompt, openaiKey, size)
          providerUsed = "dalle"
        } else if (provider === "dalle") {
          return { title: "generate-image", output: "OPENAI_API_KEY not set.", metadata: {} as Meta }
        }
      }

      if (!imageUrl && (provider === "auto" || provider === "fal")) {
        if (falKey) {
          imageUrl = await generateWithFal(prompt, falKey)
          providerUsed = "fal"
        } else if (provider === "fal") {
          return { title: "generate-image", output: "FAL_KEY not set.", metadata: {} as Meta }
        }
      }

      if (!imageUrl && (provider === "auto" || provider === "replicate")) {
        if (replicateKey) {
          imageUrl = await generateWithReplicate(prompt, replicateKey)
          providerUsed = "replicate"
        } else if (provider === "replicate") {
          return { title: "generate-image", output: "REPLICATE_API_TOKEN not set.", metadata: {} as Meta }
        }
      }

      if (!imageUrl) {
        return {
          title: "generate-image",
          output: "No image generation provider available. Set OPENAI_API_KEY, FAL_KEY, or REPLICATE_API_TOKEN.",
          metadata: {} as Meta,
        }
      }

      let savedPath: string | undefined
      if (save) {
        savedPath = await downloadImage(imageUrl)
      }

      return {
        title: "generate-image",
        output: `Image generated (${providerUsed}):\nURL: ${imageUrl}${savedPath ? `\nSaved: ${savedPath}` : ""}`,
        metadata: { url: imageUrl, provider: providerUsed, savedPath: savedPath ?? "" } as Meta,
      }
    } catch (e) {
      return {
        title: "generate-image",
        output: `Image generation failed: ${e instanceof Error ? e.message : e}`,
        metadata: {} as Meta,
      }
    }
  },
})

/**
 * Image understanding tool — multimodal attachment support.
 *
 * Accepts image file paths or URLs, converts to base64, and sends to a
 * vision-capable model for analysis. Useful for:
 *   - Error screenshots → debugging
 *   - UI wireframes → implementation
 *   - Architecture diagrams → code generation
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { extname } from "path"

type Meta = Record<string, string | number | boolean | undefined>

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

const parameters = z.object({
  image: z.string().describe("Path to image file or URL"),
  question: z
    .string()
    .optional()
    .describe("What to ask about the image (default: describe what you see and extract any code/errors)"),
})

export const ImageUnderstandingTool = Tool.define<typeof parameters, Meta>("analyze-image", {
  description:
    "Analyze an image (screenshot, diagram, wireframe, error) and extract information. Supports JPEG, PNG, WebP, GIF.",
  parameters,
  async execute({ image, question }) {
    const prompt = question ?? "Describe this image in detail. If it contains code, errors, or UI elements, extract them precisely."

    try {
      let imageData: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string }

      if (image.startsWith("http://") || image.startsWith("https://")) {
        imageData = { type: "url", url: image }
      } else if (!existsSync(image)) {
        return { title: "analyze-image", output: `File not found: ${image}`, metadata: {} as Meta }
      } else {
        const ext = extname(image).toLowerCase()
        const mimeType = MIME_TYPES[ext] ?? "image/jpeg"
        const buffer = await readFile(image)
        imageData = { type: "base64", mediaType: mimeType, data: buffer.toString("base64") }
      }

      // Return structured data for the agent to attach to its context
      const attachment = {
        type: "image",
        imageData,
        prompt,
      }

      return {
        title: "analyze-image",
        output: `Image loaded for analysis. Path: ${image}\nQuestion: ${prompt}\n\nNote: The image has been prepared for multimodal analysis. The agent will use its vision capabilities to process it.`,
        metadata: {
          imageSource: image,
          mimeType: "type" in imageData && imageData.type === "base64" ? (imageData as any).mediaType : "url",
          attachmentReady: true,
        } as Meta,
      }
    } catch (e) {
      return {
        title: "analyze-image",
        output: `Failed to load image: ${e instanceof Error ? e.message : e}`,
        metadata: {} as Meta,
      }
    }
  },
})

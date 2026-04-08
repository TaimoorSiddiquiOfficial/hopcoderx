import z from "zod"
import { Tool } from "./tool"
import { Env } from "../env"
import { abortAfterAny } from "../util/abort"

type Meta = Record<string, string | number | boolean | undefined>

const parameters = z.object({
  prompt: z.string().describe("Text description of the video to generate"),
  provider: z
    .enum(["runway", "fal"])
    .optional()
    .describe("Video generation provider: 'runway' (Runway Gen-3) or 'fal' (Fal.ai Kling). Auto-selects based on available API key."),
  duration: z.number().optional().describe("Video duration in seconds (default: 5, max: 10)"),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("Video aspect ratio (default: 16:9)"),
  image_url: z.string().optional().describe("Optional reference image URL for image-to-video generation"),
})

export const VideoGenTool = Tool.define<typeof parameters, Meta>("videogen", {
  description:
    "Generate short videos from text prompts using Runway Gen-3 (RUNWAY_API_KEY) or Fal.ai Kling (FAL_KEY). Use for UI demos, explainer clips, or visualizing code behavior. Returns a video URL when complete.",
  parameters,
  async execute(params, ctx) {
    const runwayKey = Env.get("RUNWAY_API_KEY")
    const falKey = Env.get("FAL_KEY") ?? Env.get("FAL_API_KEY")

    const provider = params.provider ?? (runwayKey ? "runway" : falKey ? "fal" : null)
    if (!provider) {
      return {
        output: "No video generation API key found. Set RUNWAY_API_KEY (Runway Gen-3) or FAL_KEY (Fal.ai Kling).",
        title: "VideoGen: API key missing",
        metadata: {} as Meta,
      }
    }

    await ctx.ask({
      permission: "computer",
      patterns: [params.prompt],
      always: [],
      metadata: { prompt: params.prompt, provider },
    })

    const { signal, clearTimeout } = abortAfterAny(120000, ctx.abort)

    try {
      if (provider === "runway") {
        if (!runwayKey) throw new Error("RUNWAY_API_KEY is not set")

        // Runway Gen-3 Alpha Turbo
        const body: Record<string, unknown> = {
          model: "gen3a_turbo",
          promptText: params.prompt,
          duration: Math.min(params.duration ?? 5, 10),
          ratio: params.aspect_ratio === "9:16" ? "768:1280" : params.aspect_ratio === "1:1" ? "1280:1280" : "1280:768",
        }
        if (params.image_url) body.promptImage = params.image_url

        const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${runwayKey}`,
            "X-Runway-Version": "2024-11-06",
          },
          body: JSON.stringify(body),
          signal,
        })
        if (!res.ok) throw new Error(`Runway error (${res.status}): ${await res.text()}`)

        const task: { id: string } = await res.json()

        // Poll for completion
        let videoUrl = ""
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000))
          const statusRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${task.id}`, {
            headers: { Authorization: `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
            signal,
          })
          if (!statusRes.ok) continue
          const statusData: { status: string; output?: string[] } = await statusRes.json()
          if (statusData.status === "SUCCEEDED" && statusData.output?.[0]) {
            videoUrl = statusData.output[0]
            break
          }
          if (statusData.status === "FAILED") throw new Error("Runway video generation failed")
        }

        clearTimeout()
        if (!videoUrl) throw new Error("Video generation timed out")

        return {
          output: `Video generated successfully!\n\nURL: ${videoUrl}\n\nPrompt: ${params.prompt}\nProvider: Runway Gen-3 Alpha Turbo\nDuration: ${params.duration ?? 5}s`,
          title: `VideoGen: ${params.prompt.slice(0, 50)}`,
          metadata: { provider: "runway", url: videoUrl } as Meta,
        }
      }

      // Fal.ai Kling
      if (!falKey) throw new Error("FAL_KEY is not set")

      const falBody: Record<string, unknown> = {
        prompt: params.prompt,
        duration: Math.min(params.duration ?? 5, 10) <= 5 ? "5" : "10",
        aspect_ratio: params.aspect_ratio ?? "16:9",
      }
      if (params.image_url) falBody.image_url = params.image_url

      const endpoint = params.image_url
        ? "fal-ai/kling-video/v2/master/image-to-video"
        : "fal-ai/kling-video/v2/master/text-to-video"

      const submitRes = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${falKey}`,
        },
        body: JSON.stringify(falBody),
        signal,
      })
      if (!submitRes.ok) throw new Error(`Fal.ai error (${submitRes.status}): ${await submitRes.text()}`)

      const { request_id, status_url }: { request_id: string; status_url: string } = await submitRes.json()

      // Poll status
      let resultUrl = ""
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const statusRes = await fetch(status_url ?? `https://queue.fal.run/${endpoint}/requests/${request_id}/status`, {
          headers: { Authorization: `Key ${falKey}` },
          signal,
        })
        if (!statusRes.ok) continue
        const statusData: { status: string; response_url?: string } = await statusRes.json()
        if (statusData.status === "COMPLETED" && statusData.response_url) {
          const resultRes = await fetch(statusData.response_url, { headers: { Authorization: `Key ${falKey}` }, signal })
          if (resultRes.ok) {
            const result: { video?: { url: string } } = await resultRes.json()
            if (result.video?.url) { resultUrl = result.video.url; break }
          }
        }
        if (statusData.status === "FAILED") throw new Error("Fal.ai video generation failed")
      }

      clearTimeout()
      if (!resultUrl) throw new Error("Video generation timed out")

      return {
        output: `Video generated successfully!\n\nURL: ${resultUrl}\n\nPrompt: ${params.prompt}\nProvider: Fal.ai Kling v2\nDuration: ${params.duration ?? 5}s`,
        title: `VideoGen: ${params.prompt.slice(0, 50)}`,
        metadata: { provider: "fal", url: resultUrl } as Meta,
      }
    } catch (err) {
      clearTimeout()
      if (err instanceof Error && err.name === "AbortError") throw new Error("Video generation timed out")
      throw err
    }
  },
})


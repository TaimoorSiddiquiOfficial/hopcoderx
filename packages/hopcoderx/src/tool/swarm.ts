import { Tool } from "./tool"
import DESCRIPTION from "./swarm.txt"
import z from "zod"
import { Swarm } from "../agent/swarm"

const parameters = z.object({
  task: z.string().describe("A clear description of the complex task to accomplish"),
  context: z
    .record(z.string(), z.string())
    .optional()
    .describe("Key-value pairs of relevant context (file paths, requirements, constraints)"),
})

export const SwarmTool = Tool.define("swarm", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const result = await Swarm.execute({
        task: params.task,
        sessionID: ctx.sessionID,
        context: params.context,
      })

      const output = [
        `<swarm-result job="${result.jobID}" status="${result.status}">`,
        result.summary,
        "",
        ...result.steps.map((s) =>
          [
            `<step id="${s.step.id}" status="${s.step.status}" retries="${s.retries}">`,
            `Task: ${s.step.task}`,
            s.review
              ? `Review: ${s.review.approved ? "approved" : "revise"} — ${s.review.summary}`
              : "",
            s.output.length > 2000 ? s.output.slice(0, 2000) + "\n... (truncated)" : s.output,
            `</step>`,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        `</swarm-result>`,
      ].join("\n")

      return {
        title: `Swarm: ${result.status} (${result.steps.length} steps)`,
        metadata: {
          jobID: result.jobID,
          status: result.status,
          steps: result.steps.length,
        },
        output,
      }
    },
  }
})

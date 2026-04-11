import { EOL } from "os"
import { Skill } from "../../../skill"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SkillCommand = cmd({
  command: "skill",
  describe: "list all available skills",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const [skills, conflicts] = await Promise.all([Skill.all(), Skill.conflicts()])
      process.stdout.write(JSON.stringify({ skills, conflicts }, null, 2) + EOL)
    })
  },
})

import { createSimpleContext } from "./helper"
import type { TuiStartupArgs } from "@/cli/tui-startup"

export type Args = TuiStartupArgs

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})

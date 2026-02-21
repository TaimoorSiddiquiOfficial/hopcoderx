export const deepLinkEvent = "HopCoderX:deep-link"

export const parseDeepLink = (input: string) => {
  if (!input.startsWith("HopCoderX://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  const url = (() => {
    try {
      return new URL(input)
    } catch {
      return undefined
    }
  })()
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

type HopCoderXWindow = Window & {
  __HOPCODERX__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: HopCoderXWindow) => {
  const pending = target.__HOPCODERX__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__HOPCODERX__) target.__HOPCODERX__.deepLinks = []
  return pending
}

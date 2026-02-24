// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { createSignal } from "solid-js"

// Use browser UA to determine platform to avoid plugin-os dependency in dev.
const OS_NAME = (() => {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "macos"
  if (ua.includes("linux")) return "linux"
  return "windows"
})()

const [webviewZoom, setWebviewZoom] = createSignal(1)

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

const clamp = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

const applyZoom = (next: number) => {
  setWebviewZoom(next)
  invoke("plugin:webview|set_webview_zoom", {
    value: next,
  })
}

window.addEventListener("keydown", (event) => {
  if (!(OS_NAME === "macos" ? event.metaKey : event.ctrlKey)) return

  let newZoom = webviewZoom()

  if (event.key === "-") newZoom -= 0.2
  if (event.key === "=" || event.key === "+") newZoom += 0.2
  if (event.key === "0") newZoom = 1

  applyZoom(clamp(newZoom))
})

export { webviewZoom }

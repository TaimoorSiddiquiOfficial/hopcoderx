import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { SecurityGuard } from "@/security/guard"
import { QuotaTracker } from "@/telemetry/quota"
import { VectorMemory } from "@/memory/vector"
import { MemoryPlugin } from "@/memory/memory"
import { OpenTelemetryExporter } from "@/telemetry/otel"
import { NotificationManager } from "@/notification"

function runDeferredBootstrapTask(task: string, init: () => Promise<void>, delayMs = 0) {
  setTimeout(() => {
    init().catch((error) => {
      Log.Default.error("deferred bootstrap task failed", {
        task,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, delayMs)
}

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  // Keep launch-critical initialization minimal so the TUI can render promptly.
  // Optional services continue starting in the background.
  await SecurityGuard.init()

  runDeferredBootstrapTask("quota-tracker", () => QuotaTracker.init())

  if (MemoryPlugin.isActive()) {
    runDeferredBootstrapTask("vector-memory", () => VectorMemory.init(MemoryPlugin.active))
  }

  runDeferredBootstrapTask("open-telemetry", () => OpenTelemetryExporter.init())
  runDeferredBootstrapTask("notification-manager", () => NotificationManager.init())

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}

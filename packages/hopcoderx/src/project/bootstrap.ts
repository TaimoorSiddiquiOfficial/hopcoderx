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
import { MCP } from "@/mcp"
import { SecurityGuard } from "@/security/guard"
import { QuotaTracker } from "@/telemetry/quota"
import { VectorMemory } from "@/memory/vector"
import { MemoryPlugin } from "@/memory/memory"
import { OpenTelemetryExporter } from "@/telemetry/otel"
import { NotificationManager } from "@/notification"

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

  // Initialize security guard
  await SecurityGuard.init()

  // Initialize quota tracker
  await QuotaTracker.init()

  // Initialize vector memory if backend is available
  if (MemoryPlugin.isActive()) {
    await VectorMemory.init(MemoryPlugin.active)
  }

  // Initialize OpenTelemetry exporter
  await OpenTelemetryExporter.init()

  // Initialize notification manager
  await NotificationManager.init()

  // Start built-in MCP servers (always-on + context-detected on-demand)
  MCP.initBuiltins(Instance.directory).catch((err) => {
    Log.Default.error("failed to init builtin MCP servers", { error: err })
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}

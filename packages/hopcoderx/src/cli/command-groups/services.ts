import { ServeCommand } from "../cmd/serve"
import { WebCommand } from "../cmd/web"
import { DaemonCommand } from "../cmd/daemon"
import { CronCommand } from "../cmd/cron"
import { WebhooksCommand } from "../cmd/webhooks"
import { HooksCommand } from "../cmd/hooks"
import { ChannelsCommand } from "../cmd/channels"

export const servicesCommandGroup = {
  name: "services",
  title: "Services & daemons",
  summary: ["serve", "daemon", "web", "channels", "hooks", "webhooks", "cron"],
  commands: [ServeCommand, DaemonCommand, WebCommand, ChannelsCommand, HooksCommand, WebhooksCommand, CronCommand],
}

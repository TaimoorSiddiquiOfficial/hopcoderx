import { ServeCommand } from "../cmd/serve"
import { WebCommand } from "../cmd/web"
import { DaemonCommand } from "../cmd/daemon"
import { CronCommand } from "../cmd/cron"
import { WebhooksCommand } from "../cmd/webhooks"
import { HooksCommand } from "../cmd/hooks"
import { ChannelsCommand } from "../cmd/channels"
import { servicesTaxonomy } from "../command-taxonomy"

export const servicesCommandGroup = {
  ...servicesTaxonomy,
  commands: [ServeCommand, DaemonCommand, WebCommand, ChannelsCommand, HooksCommand, WebhooksCommand, CronCommand],
}

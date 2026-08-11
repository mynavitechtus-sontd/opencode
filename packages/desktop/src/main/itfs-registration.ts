import { createItfsPlugin, ApiClient } from "@opencode-ai/itfs"
import { ItfsTokenStore } from "./itfs-token-store"

export async function registerItfsTools(
  opencode: { tools: { register: (tools: Record<string, unknown>) => Promise<void> } },
  tokenStore: ItfsTokenStore,
) {
  const client = new ApiClient(() => tokenStore.getAccessToken())
  client.tryRefreshToken = () => tokenStore.refreshAccessToken()

  const plugin = createItfsPlugin({ client, skillNames: {} })

  await opencode.tools.register(plugin.tools)

  return plugin
}

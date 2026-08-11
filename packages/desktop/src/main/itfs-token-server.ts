import { createServer } from "node:http"
import type { ItfsTokenStore } from "./itfs-token-store"

export function startItfsTokenServer(tokenStore: ItfsTokenStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (_req, res) => {
      let token = await tokenStore.getAccessToken()
      if (!token) {
        const refreshed = await tokenStore.refreshAccessToken()
        if (refreshed) token = await tokenStore.getAccessToken()
      }
      if (!token) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "No ITFS token available" }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ token }))
    })

    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address && typeof address === "object") {
        resolve(address.port)
      } else {
        server.close()
        reject(new Error("Failed to get port"))
      }
    })
  })
}

import { createServer } from "node:http"
import { loadAndDecrypt } from "./auth"

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    return payload.exp * 1000 < Date.now() + 2 * 60 * 1000
  } catch {
    return true
  }
}

async function refreshToken(): Promise<string | null> {
  const refreshToken = loadAndDecrypt("refresh_token")
  if (!refreshToken) return null
  const deviceId = (await import("./auth")).getDeviceId()
  const baseUrl = process.env.ITFS_API_URL ?? "http://localhost:3000"
  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshToken}` },
      body: JSON.stringify({ device_id: deviceId }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token: string; refresh_token: string }
    const { encryptAndSave } = await import("./auth")
    encryptAndSave("access_token", json.access_token)
    encryptAndSave("refresh_token", json.refresh_token)
    return json.access_token
  } catch {
    return null
  }
}

export function startItfsTokenServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (_req, res) => {
      let token = loadAndDecrypt("access_token")
      if (token && isTokenExpired(token)) {
        token = await refreshToken()
      }
      if (!token) {
        token = await refreshToken()
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

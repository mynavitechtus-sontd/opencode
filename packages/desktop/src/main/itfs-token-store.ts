import { safeStorage } from "electron"
import { getStore } from "./store"

export class ItfsTokenStore {
  private store = getStore("itfs-tokens")

  async saveTokens(accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
    const encrypted = safeStorage.encryptString(accessToken)
    const encryptedRefresh = safeStorage.encryptString(refreshToken)
    this.store.set("access_token", encrypted.toString("base64"))
    this.store.set("refresh_token", encryptedRefresh.toString("base64"))
    this.store.set("expires_at", expiresAt)
  }

  async getAccessToken(): Promise<string | null> {
    const encrypted = this.store.get("access_token") as string | undefined
    if (!encrypted) return null
    if (!safeStorage.isEncryptionAvailable()) return null

    const expiresAt = this.store.get("expires_at") as number | undefined
    if (expiresAt && Date.now() > expiresAt) return null

    const buffer = Buffer.from(encrypted, "base64")
    return safeStorage.decryptString(buffer)
  }

  async getRefreshToken(): Promise<string | null> {
    const encrypted = this.store.get("refresh_token") as string | undefined
    if (!encrypted) return null
    if (!safeStorage.isEncryptionAvailable()) return null

    const buffer = Buffer.from(encrypted, "base64")
    return safeStorage.decryptString(buffer)
  }

  async refreshAccessToken(): Promise<boolean> {
    const refreshToken = await this.getRefreshToken()
    if (!refreshToken) return false

    try {
      const baseUrl = process.env.ITFS_API_URL ?? "http://localhost:3000"
      const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshToken}` },
      })
      if (!res.ok) return false

      const json = await res.json()
      await this.saveTokens(json.access_token, json.refresh_token, Date.now() + json.expires_in * 1000)
      return true
    } catch {
      return false
    }
  }

  clear(): void {
    this.store.delete("access_token")
    this.store.delete("refresh_token")
    this.store.delete("expires_at")
  }
}

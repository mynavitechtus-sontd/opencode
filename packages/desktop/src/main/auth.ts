import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, safeStorage } from "electron"

export type AuthUser = {
  uuid: string
  email: string
  fullname: string
  avatar_url?: string
}

export type AuthState =
  | { status: "signedOut"; user?: never }
  | { status: "signedIn"; user: AuthUser }

export function ensureAuthDir() {
  const dir = join(app.getPath("userData"), "auth")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getDeviceId() {
  const dir = ensureAuthDir()
  const filepath = join(dir, "device_id.txt")
  if (existsSync(filepath)) return readFileSync(filepath, "utf8")
  const id = randomUUID()
  writeFileSync(filepath, id)
  return id
}

export function encryptAndSave(key: string, data: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable")
  const dir = ensureAuthDir()
  const encrypted = safeStorage.encryptString(data)
  writeFileSync(join(dir, `${key}.enc`), encrypted)
}

export function loadAndDecrypt(key: string): string | null {
  const dir = ensureAuthDir()
  const filepath = join(dir, `${key}.enc`)
  if (!existsSync(filepath)) return null
  if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable")
  return safeStorage.decryptString(readFileSync(filepath))
}

export function saveUserProfile(user: AuthUser) {
  const dir = ensureAuthDir()
  writeFileSync(join(dir, "user.json"), JSON.stringify(user))
}

export function loadUserProfile(): AuthUser | null {
  const dir = ensureAuthDir()
  const filepath = join(dir, "user.json")
  if (!existsSync(filepath)) return null
  return JSON.parse(readFileSync(filepath, "utf8")) as AuthUser
}

export function clearAllTokens() {
  const dir = ensureAuthDir()
  for (const file of ["access_token.enc", "refresh_token.enc", "user.json"]) {
    try { unlinkSync(join(dir, file)) } catch {}
  }
}

export function getApiBaseUrl() {
  return process.env.ITFS_API_URL ?? "http://localhost:3000"
}

async function apiRequest(method: string, path: string, body?: unknown, bearer?: string) {
  const url = `${getApiBaseUrl()}${path}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`
  const options: RequestInit = { method, headers }
  if (body) options.body = JSON.stringify(body)
  const response = await fetch(url, options)
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

async function refreshAccessToken(refreshToken: string, deviceId: string) {
  const data = await apiRequest("POST", "/api/v1/auth/refresh", { device_id: deviceId }, refreshToken) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  encryptAndSave("access_token", data.access_token)
  encryptAndSave("refresh_token", data.refresh_token)
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

export async function loadSessionOnStartup(): Promise<AuthState> {
  const refreshToken = loadAndDecrypt("refresh_token")
  if (!refreshToken) return { status: "signedOut" }
  const deviceId = getDeviceId()
  try {
    await refreshAccessToken(refreshToken, deviceId)
    const accessToken = loadAndDecrypt("access_token")
    if (!accessToken) return dropSession()
    const data = await apiRequest("GET", "/api/v1/auth/me", undefined, accessToken) as { user: AuthUser }
    if (data?.user) {
      saveUserProfile(data.user)
      return { status: "signedIn", user: data.user }
    }
    return dropSession()
  } catch {
    return dropSession()
  }
}

function dropSession(): AuthState & { status: "signedOut" } {
  clearAllTokens()
  return { status: "signedOut" }
}

export async function signOut() {
  const accessToken = loadAndDecrypt("access_token")
  const deviceId = getDeviceId()
  if (accessToken) {
    try {
      await apiRequest("POST", "/api/v1/auth/revoke", { device_id: deviceId }, accessToken)
    } catch {}
  }
  clearAllTokens()
}

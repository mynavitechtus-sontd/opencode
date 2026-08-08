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

# Google Sign-In for Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sign-In authentication with PKCE OAuth2, login page, user avatar menu, Log out, and URL scheme change from `opencode://` to `itfs://`.

**Architecture:** All auth logic (safeStorage, OAuth flow, HTTP calls, itfs:// callback) lives in main process (`src/main/auth.ts`). Renderer only holds `AuthState` via `window.api.auth` IPC and renders `<LoginScreen />` or `<AppInterface />` on start.

**Tech Stack:** Electron `safeStorage`, fetch API (main process), SolidJS (renderer), MenuV2/AvatarV2 (ui package), electron-vite.

## Global Constraints

- Renderer process must only call `window.api` from `src/preload`.
- Main process must register IPC handlers in `src/main/ipc.ts`.
- NEVER hardcode user-visible English strings — use i18n keys; English is source copy, preserve byte-for-byte.
- Parity test (`packages/app/src/i18n/parity.test.ts`) enforces every English key present in all 28 desktop locale files.
- Keep runtime dependencies directed from Schema to Core and Protocol.
- Prefer `const` over `let`; avoid `else`; use early returns; no `any` type.
- No aliased imports; no star imports.
- Use Bun APIs when possible; use functional array methods.
- Drizzle schema uses snake_case field names.

---

### Task 1: Replace `opencode://` URL scheme with `itfs://`

**Files:**
- Modify: `packages/app/src/pages/layout/deep-links.ts:4`
- Modify: `packages/app/src/pages/layout/helpers.test.ts:41-108`
- Modify: `packages/desktop/src/main/index.ts:206,271`
- Modify: `packages/desktop/electron-builder.config.ts:88-91,131,140,151`

**Interfaces:**
- Consumes: nothing — no prior tasks
- Produces: deep-link parsing accepts `itfs://` URLs; main process registers `itfs` protocol; builder config updated

- [ ] **Step 1: Update deep-links.ts parseUrl filter and test file**

In `packages/app/src/pages/layout/deep-links.ts`, change the parseUrl filter:
```ts
// line 4: replace
if (!input.startsWith("opencode://")) return
// with
if (!input.startsWith("itfs://")) return
```

In `packages/app/src/pages/layout/helpers.test.ts`, replace all `opencode://` literals with `itfs://`. Search-and-replace the string `opencode://` → `itfs://` throughout the test file (lines 41, 45, 50, 51, 58, 66, 67, 72, 73, 74, 80, 81, 88, 89, 94, 95, 96, 104, 108).

- [ ] **Step 2: Run deep link tests to verify**

```bash
cd /home/sontd/workspace/opencode/packages/app && bun test src/pages/layout/helpers.test.ts
```
Expected: All tests pass with `itfs://` scheme.

- [ ] **Step 3: Update main process index.ts**

In `packages/desktop/src/main/index.ts`:
- Line 206: `arg.startsWith("opencode://")` → `arg.startsWith("itfs://")`
- Line 271: `app.setAsDefaultProtocolClient("opencode")` → `app.setAsDefaultProtocolClient("itfs")`

- [ ] **Step 4: Update electron-builder.config.ts**

In `packages/desktop/electron-builder.config.ts`, change `schemes: ["opencode"]` to `schemes: ["itfs"]` in all three locations:
- Line 90: in `getBase`
- Line 140: in beta channel override
- Line 151: in prod channel override

- [ ] **Step 5: Commit**

```bash
git add \
  packages/app/src/pages/layout/deep-links.ts \
  packages/app/src/pages/layout/helpers.test.ts \
  packages/desktop/src/main/index.ts \
  packages/desktop/electron-builder.config.ts
git commit -m "chore(desktop): replace opencode:// URL scheme with itfs://"
```

---

### Task 2: Create token store in `main/auth.ts` (safeStorage + device ID)

**Files:**
- Create: `packages/desktop/src/main/auth.ts`

**Interfaces:**
- Consumes: `safeStorage` from electron, `app.getPath("userData")` from electron
- Produces:
  - `function ensureAuthDir(): string` — returns path to `userData/auth/` directory
  - `function getDeviceId(): string` — returns or generates UUID v4, saves to `device_id.txt`
  - `function encryptAndSave(key: string, data: string): void` — safeStorage.encryptString → write file `auth/{key}.enc`
  - `function loadAndDecrypt(key: string): string | null` — read `auth/{key}.enc` → safeStorage.decryptString
  - `function saveUserProfile(user: AuthUser): void` — write to `auth/user.json`
  - `function loadUserProfile(): AuthUser | null` — read from `auth/user.json`
  - `function clearAllTokens(): void` — delete files `access_token.enc`, `refresh_token.enc`, `user.json`

- [ ] **Step 1: Create `packages/desktop/src/main/auth.ts` with token store functions**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/main/auth.ts
git commit -m "feat(desktop): add safeStorage token store module"
```

---

### Task 3: Add auth API client (refresh/me/revoke) to `main/auth.ts`

**Files:**
- Modify: `packages/desktop/src/main/auth.ts` (append)

**Interfaces:**
- Consumes: `loadAndDecrypt`, `encryptAndSave`, `saveUserProfile`, `clearAllTokens`, `getDeviceId` from Task 2
- Produces:
  - `function getApiBaseUrl(): string` — `process.env.ITFS_API_URL ?? "http://localhost:3000"`
  - `async function loadSessionOnStartup(): Promise<AuthState>` — loads tokens, calls refresh + me, returns state
  - `async function signOut(): Promise<void>` — POST /auth/revoke, clear tokens
  - `async function refreshAccessToken(refreshToken: string, deviceId: string): Promise<{ accessToken: string; refreshToken: string } | null>`

- [ ] **Step 1: Append API client functions to `main/auth.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/main/auth.ts
git commit -m "feat(desktop): add auth API client (refresh/me/revoke)"
```

---

### Task 4: Add OAuth flow and state broadcast to `main/auth.ts`

**Files:**
- Modify: `packages/desktop/src/main/auth.ts` (append)

**Interfaces:**
- Consumes: `loadSessionOnStartup`, `signOut`, `getApiBaseUrl`, `encryptAndSave`, `saveUserProfile`, `getDeviceId`, `AuthState`, `AuthUser` from Task 2-3; `shell` from electron
- Produces:
  - `function createAuthService(): AuthService` — returns unsubscribe-able service
  - `AuthService.beginGoogleSignIn()`: opens external
  - `AuthService.handleAuthCallback(url)`: parse fragment, store, fetch me, broadcast
  - `AuthService.subscribe(cb)`/broadcast: state subscription
  - `function routeUrl(url: string, auth: AuthService): boolean` — returns true if url was an auth callback (handled), false if it should go to deep links

- [ ] **Step 1: Append OAuth flow + state broadcast + routing to `main/auth.ts`**

```ts
import { shell } from "electron"

export type AuthService = ReturnType<typeof createAuthService>

export function createAuthService() {
  const listeners = new Set<(state: AuthState) => void>()

  const broadcast = (state: AuthState) => {
    for (const cb of listeners) cb(state)
  }

  return {
    loadSessionOnStartup,
    signOut: async () => {
      await signOut()
      broadcast({ status: "signedOut" })
    },
    beginGoogleSignIn() {
      void shell.openExternal(`${getApiBaseUrl()}/api/v1/auth/google`)
    },
    subscribe(cb: (state: AuthState) => void) {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
    async handleAuthCallback(url: string) {
      const fragment = url.split("#")[1]
      if (!fragment) {
        const errorParams = new URLSearchParams(url.split("?")[1] ?? "")
        const error = errorParams.get("error")
        broadcast({ status: "signedOut" })
        return
      }
      const params = new URLSearchParams(fragment)
      const accessToken = params.get("access_token")
      const refreshToken = params.get("refresh_token")
      const deviceId = params.get("device_id")
      if (!accessToken || !refreshToken || !deviceId) {
        broadcast({ status: "signedOut" })
        return
      }
      encryptAndSave("access_token", accessToken)
      encryptAndSave("refresh_token", refreshToken)
      try {
        const data = await apiRequest("GET", "/api/v1/auth/me", undefined, accessToken) as { user: AuthUser }
        if (data?.user) {
          saveUserProfile(data.user)
          broadcast({ status: "signedIn", user: data.user })
          return
        }
      } catch {}
      broadcast({ status: "signedOut" })
    },
    broadcast,
  }
}

export function routeUrl(url: string, auth: AuthService): boolean {
  try {
    const u = new URL(url)
    if (u.hostname === "auth") {
      void auth.handleAuthCallback(url)
      return true
    }
    return false
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/main/auth.ts
git commit -m "feat(desktop): add OAuth flow and state broadcast to auth service"
```

---

### Task 5: Wire auth into IPC handlers and main process routing

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts:35-55,57-64`
- Modify: `packages/desktop/src/main/index.ts:84-95,205-222,246-249,271-273,283-313`

**Interfaces:**
- Consumes: `createAuthService`, `AuthService`, `AuthState`, `routeUrl` from `auth.ts` (Task 4)
- Produces: auth IPC handlers registered; itfs:// callback routing in main process

- [ ] **Step 1: Add `auth` to `Deps` type in `ipc.ts`**

In `packages/desktop/src/main/ipc.ts`, add import and extend `Deps`:
```ts
// Add import at top (after existing imports)
import type { AuthService, AuthState } from "./auth"
```

Extend the `Deps` type (add after line 55):
```ts
  auth: {
    service: AuthService
    routeUrl: (url: string) => boolean
  }
```

- [ ] **Step 2: Register auth IPC handlers in `registerIpcHandlers`**

Insert the following code before the closing `}` of `registerIpcHandlers` (after the existing `run-desktop-menu-action` handler, around line 299):

```ts
  const authSubscriptions = new Map<number, () => void>()
  ipcMain.handle("auth:get-state", () => deps.auth.service.loadSessionOnStartup())
  ipcMain.handle("auth:sign-in", () => {
    deps.auth.service.beginGoogleSignIn()
  })
  ipcMain.handle("auth:sign-out", () => deps.auth.service.signOut())
  ipcMain.handle("auth:subscribe", (event: IpcMainInvokeEvent) => {
    const id = event.sender.id
    authSubscriptions.get(id)?.()
    const unsub = deps.auth.service.subscribe((state: AuthState) => {
      if (event.sender.isDestroyed()) {
        authSubscriptions.delete(id)
        return
      }
      event.sender.send("auth:state-changed", state)
    })
    authSubscriptions.set(id, unsub)
    event.sender.once("destroyed", () => {
      authSubscriptions.delete(id)
      unsub()
    })
  })
```

- [ ] **Step 3: Wire auth into main `index.ts`**

In `packages/desktop/src/main/index.ts`:
- Add import at top: `import { createAuthService, routeUrl } from "./auth"`
- After line 152 (inside `const main = Effect.gen...`, after `const wslServers = ...`), add:

```ts
  const auth = createAuthService()
```

Keep `emitDeepLinks` unchanged. Route URLs at the call sites instead (no closure issues):

Replace the second-instance handler (lines 205-216):
```ts
  app.on("second-instance", (_event: Event, argv: string[]) => {
    const itfsUrls = argv.filter((arg: string) => arg.startsWith("itfs://"))
    if (itfsUrls.length) {
      const deepLinks = itfsUrls.filter((url) => !routeUrl(url, auth))
      if (deepLinks.length) {
        logger.log("deep link received via second-instance", { urls: deepLinks })
        emitDeepLinks(deepLinks)
      }
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })
```

Replace the open-url handler (lines 218-222):
```ts
  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    if (!url.startsWith("itfs://")) return
    if (routeUrl(url, auth)) {
      logger.log("auth callback received via open-url", { url })
      return
    }
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })
```

In the `registerIpcHandlers` call (around line 294), add `auth` to the deps object:
```ts
    auth: {
      service: auth,
      routeUrl: (url: string) => routeUrl(url, auth),
    },
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/ipc.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): wire auth IPC handlers and itfs:// callback routing"
```

---

### Task 6: Expose `window.api.auth` in preload

**Files:**
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `AuthState`, `AuthUser` from `auth.ts` types (must expose matching interfaces to preload)
- Produces: `window.api.auth` with `getState`, `signIn`, `signOut`, `subscribe`

- [ ] **Step 1: Add auth types to preload `types.ts`**

In `packages/desktop/src/preload/types.ts`, append:

```ts
export type AuthUser = {
  uuid: string
  email: string
  fullname: string
  avatar_url?: string
}

export type AuthState =
  | { status: "signedOut"; user?: never }
  | { status: "signedIn"; user: AuthUser }

export type AuthAPI = {
  getState(): Promise<AuthState>
  signIn(): Promise<void>
  signOut(): Promise<void>
  subscribe(cb: (state: AuthState) => void): () => void
}
```

Add `auth: AuthAPI` to the `ElectronAPI` type (after existing entries):

```ts
  auth: AuthAPI
```

- [ ] **Step 2: Expose `window.api.auth` in preload `index.ts`**

In `packages/desktop/src/preload/index.ts`, add to the `api` object (after line 135, before the closing `}` of the `api` definition):

```ts
  auth: {
    getState: () => ipcRenderer.invoke("auth:get-state"),
    signIn: () => ipcRenderer.invoke("auth:sign-in"),
    signOut: () => ipcRenderer.invoke("auth:sign-out"),
    subscribe: (cb) => {
      const handler = (_: unknown, state: AuthState) => cb(state)
      ipcRenderer.on("auth:state-changed", handler)
      void ipcRenderer.invoke("auth:subscribe")
      return () => {
        ipcRenderer.removeListener("auth:state-changed", handler)
      }
    },
  },
```

Add import at top:
```ts
import type { AuthState } from "./types"
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts
git commit -m "feat(desktop): expose window.api.auth in preload"
```

---

### Task 7: Create renderer auth store (`renderer/auth.ts`)

**Files:**
- Create: `packages/desktop/src/renderer/auth.ts`

**Interfaces:**
- Consumes: `window.api.auth` from preload
- Produces: `createAuthStore()` returning `{ state: Accessor<AuthState>, signIn, signOut }`

- [ ] **Step 1: Create `packages/desktop/src/renderer/auth.ts`**

```ts
import { createSignal, onCleanup } from "solid-js"
import type { AuthState } from "../preload/types"

export function createAuthStore() {
  const [state, setState] = createSignal<AuthState>({ status: "signedOut" })

  const unsub = window.api.auth.subscribe(setState)
  onCleanup(unsub)

  return {
    state,
    signIn: () => window.api.auth.signIn(),
    signOut: () => window.api.auth.signOut(),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/auth.ts
git commit -m "feat(desktop): add renderer auth store"
```

---

### Task 8: Create login page (`renderer/login.tsx`)

**Files:**
- Create: `packages/desktop/src/renderer/login.tsx`

**Interfaces:**
- Consumes: `createAuthStore` from Task 7, `Splash` from `@opencode-ai/ui/logo`, UI components
- Produces: `<LoginScreen>` SolidJS component — centered page with Google button and drag region

- [ ] **Step 1: Create `packages/desktop/src/renderer/login.tsx`**

```tsx
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@opencode-ai/app"
import { Button } from "@opencode-ai/ui/button"
import { Splash } from "@opencode-ai/ui/logo"
import { createAuthStore } from "./auth"

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export function LoginScreen() {
  const language = useLanguage()
  const auth = createAuthStore()
  const [error, setError] = createSignal<string | null>(null)

  const handleSignIn = async () => {
    try {
      await auth.signIn()
    } catch (err) {
      setError(language.t("desktop.auth.signIn.error.default"))
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <div class="absolute inset-x-0 top-0 h-10" style="-webkit-app-region: drag" />
      <div class="flex flex-col items-center gap-8">
        <Splash class="w-16 h-20 opacity-50" />
        <Button
          variant="primary"
          size="medium"
          class="min-w-[240px] gap-2"
          onClick={handleSignIn}
        >
          <GoogleLogo />
          {language.t("desktop.auth.signIn.withGoogle")}
        </Button>
        <Show when={error()}>
          {(msg) => (
            <p class="text-12-regular text-red-500">{msg()}</p>
          )}
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/login.tsx
git commit -m "feat(desktop): add login page with Google sign-in button"
```

---

### Task 9: Add auth gate to renderer `index.tsx`

**Files:**
- Modify: `packages/desktop/src/renderer/index.tsx`

**Interfaces:**
- Consumes: `LoginScreen` from Task 8, `createAuthStore` from Task 7, `window.api.auth` from preload
- Produces: Auth gate: loading → LoadingSplash, signedOut → LoginScreen, signedIn → AppInterface

- [ ] **Step 1: Modify `DesktopRoot` to gate on auth state**

In `packages/desktop/src/renderer/index.tsx`, add import:
```tsx
import { LoginScreen } from "./login"
```

In the `DesktopRoot` function (around line 349-351), add auth resource parallel to sidecar:
```tsx
  const [authLoading] = createResource(() => window.api.auth.getState())
```

In the `App` function, change the `ready` memo (line 379-381) from:
```tsx
    const ready = createMemo(
      () => !defaultServer.loading && !sidecar.loading && !locale.loading && !wslServers.isLoading,
    )
```
to:
```tsx
    const ready = createMemo(
      () => !defaultServer.loading && !sidecar.loading && !locale.loading && !authLoading.loading && !wslServers.isLoading,
    )
```

In the `DesktopRoot` return (line 427-436), wrap the rendering to gate on auth. Modify the return to:

```tsx
  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders
        locale={locale.latest}
        onNativeTranslations={(bundle) => void window.api.setNativeTranslations(bundle).catch(() => undefined)}
      >
        <Show when={!authLoading.loading} fallback={<LoadingSplash />}>
          <Show when={authLoading.latest?.status === "signedIn"} fallback={<LoginScreen />}>
            <App />
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/index.tsx
git commit -m "feat(desktop): add auth gate to renderer"
```

---

### Task 10: Create user menu component (`renderer/user-menu.tsx`)

**Files:**
- Create: `packages/desktop/src/renderer/user-menu.tsx`
- Modify: `packages/desktop/src/renderer/index.tsx` (mount component)

**Interfaces:**
- Consumes: `createAuthStore` from Task 7, `useTitlebarRightMount` from `@opencode-ai/app`, `AvatarV2` from `@opencode-ai/ui/v2/avatar-v2`, `MenuV2` from `@opencode-ai/ui/v2/menu-v2`, `Portal` from `solid-js/web`, `useLanguage` from `@opencode-ai/app`
- Produces: `<DesktopUserMenu>` component mounted into `#opencode-titlebar-right`

- [ ] **Step 1: Create `packages/desktop/src/renderer/user-menu.tsx`**

```tsx
import { Portal } from "solid-js/web"
import { Show } from "solid-js"
import { useLanguage } from "@opencode-ai/app"
import { useTitlebarRightMount } from "@opencode-ai/app/components/titlebar"
import { Avatar } from "@opencode-ai/ui/v2/avatar-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createAuthStore } from "./auth"

export function DesktopUserMenu() {
  const language = useLanguage()
  const auth = createAuthStore()
  const rightMount = useTitlebarRightMount()

  return (
    <Show when={rightMount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={auth.state().status === "signedIn" && auth.state().user} keyed>
            {(user) => (
              <MenuV2 gutter={4} modal={false} placement="bottom-end">
                <MenuV2.Trigger as="button" type="button" class="outline-none">
                  <Avatar
                    size="small"
                    src={user.avatar_url}
                    fallback={user.fullname}
                  />
                </MenuV2.Trigger>
                <MenuV2.Portal>
                  <MenuV2.Content>
                    <div class="flex items-center gap-2 px-3 py-2">
                      <Avatar
                        size="small"
                        src={user.avatar_url}
                        fallback={user.fullname}
                      />
                      <div class="flex flex-col min-w-0">
                        <span class="text-12-semibold text-text-base truncate">{user.fullname}</span>
                        <span class="text-11-regular text-text-weak truncate">{user.email}</span>
                      </div>
                    </div>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => auth.signOut()}>
                      {language.t("desktop.auth.userMenu.logout")}
                    </MenuV2.Item>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
            )}
          </Show>
        </Portal>
      )}
    </Show>
  )
}
```

- [ ] **Step 2: Mount `DesktopUserMenu` inside the app tree**

In `packages/desktop/src/renderer/index.tsx`, add import at top:
```tsx
import { DesktopUserMenu } from "./user-menu"
```

In the `Inner` function (line 358-374), replace `return null` with:
```tsx
    return (
      <>
        <DesktopUserMenu />
      </>
    )
```

`Inner` renders inside `AppInterface` children, inside `SharedProviders` alongside `NewAppLayout`. SolidJS processes all JSX synchronously before `onMount` effects fire, so `#opencode-titlebar-right` (rendered by Titlebar inside NewAppLayout) exists in DOM when `useTitlebarRightMount` looks for it.

- [ ] **Step 3: Commit**

```bash
git add \
  packages/desktop/src/renderer/user-menu.tsx \
  packages/desktop/src/renderer/index.tsx
git commit -m "feat(desktop): add user avatar menu in titlebar"
```

---

### Task 11: Add i18n keys to all desktop locale files

**Files:**
- Modify: `packages/desktop/src/renderer/i18n/en.ts`
- Modify: `packages/desktop/src/renderer/i18n/vi.ts`
- Modify: `packages/desktop/src/renderer/i18n/*.ts` (all 28 locale files)

**Interfaces:**
- Consumes: nothing
- Produces: 5 i18n keys present in every locale file for parity test

- [ ] **Step 1: Add keys to English source (`en.ts`)**

In `packages/desktop/src/renderer/i18n/en.ts`, append to the `dict` object:

```ts
  "desktop.auth.signIn.title": "Sign in",
  "desktop.auth.signIn.withGoogle": "Continue with Google",
  "desktop.auth.signIn.error.default": "Sign in failed. Please try again.",
  "desktop.auth.signIn.error.encryption": "Your system does not support secure storage.",
  "desktop.auth.userMenu.logout": "Log out",
```

- [ ] **Step 2: Add keys to Vietnamese (`vi.ts`)**

In `packages/desktop/src/renderer/i18n/vi.ts`, append to the `dict` object:

```ts
  "desktop.auth.signIn.title": "Đăng nhập",
  "desktop.auth.signIn.withGoogle": "Tiếp tục với Google",
  "desktop.auth.signIn.error.default": "Đăng nhập thất bại. Vui lòng thử lại.",
  "desktop.auth.signIn.error.encryption": "Hệ thống của bạn không hỗ trợ lưu trữ bảo mật.",
  "desktop.auth.userMenu.logout": "Đăng xuất",
```

- [ ] **Step 3: Add keys to all remaining 26 locale files**

For each locale file in `packages/desktop/src/renderer/i18n/` EXCEPT `en.ts` and `vi.ts`, append the same English values:

```ts
  "desktop.auth.signIn.title": "Sign in",
  "desktop.auth.signIn.withGoogle": "Continue with Google",
  "desktop.auth.signIn.error.default": "Sign in failed. Please try again.",
  "desktop.auth.signIn.error.encryption": "Your system does not support secure storage.",
  "desktop.auth.userMenu.logout": "Log out",
```

Files to update: `ar.ts`, `az.ts`, `br.ts`, `bs.ts`, `da.ts`, `de.ts`, `es.ts`, `fi.ts`, `fr.ts`, `hi.ts`, `id.ts`, `it.ts`, `ja.ts`, `ko.ts`, `nl.ts`, `no.ts`, `pa.ts`, `pl.ts`, `ru.ts`, `sv.ts`, `th.ts`, `tr.ts`, `uk.ts`, `ur.ts`, `zh.ts`, `zht.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/i18n/
git commit -m "feat(desktop): add auth i18n keys to all locale files"
```

---

### Task 12: Run tests, typecheck, and final verification

**Files:**
- Modify: None (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-11
- Produces: green tests, typecheck passing

- [ ] **Step 1: Run deep-link tests**

```bash
cd /home/sontd/workspace/opencode/packages/app && bun test src/pages/layout/helpers.test.ts
```
Expected: All pass.

- [ ] **Step 2: Run i18n parity test (if not CI)**

```bash
cd /home/sontd/workspace/opencode/packages/app && bun test src/i18n/parity.test.ts
```
Expected: All pass (keys present in all locales).

- [ ] **Step 3: Run typecheck on desktop package**

```bash
cd /home/sontd/workspace/opencode/packages/desktop && bun typecheck
```
Expected: No errors.

- [ ] **Step 4: Run desktop tests**

```bash
cd /home/sontd/workspace/opencode/packages/desktop && bun test
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(desktop): verify auth feature — tests, typecheck, i18n parity" --allow-empty
```
(Only commit if changes were needed from test/typecheck fixes; otherwise an empty commit documents verification.)

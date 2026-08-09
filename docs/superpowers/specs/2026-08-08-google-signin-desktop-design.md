# Google Sign-In for Desktop App — Design Specification

**Date:** 2026-08-08
**Status:** Draft

## Overview

Add Google Sign-In authentication (backend-proxied OAuth2 with PKCE + JWT tokens) to the Electron desktop app. When the app starts, if the user is not signed in, show a login page; otherwise show the existing main app. Add a user avatar menu with Log out in the header bar. Replace the URL scheme from `opencode://` to `itfs://` per ADR-001.

## Architecture

### Auth Ownership: Main Process

All auth logic lives in the main process (`src/main/auth.ts`). The renderer never sees raw tokens; it only receives `AuthState` via IPC and triggers actions through `window.api.auth`.

| Layer | Role |
|---|---|
| `main/auth.ts` | safeStorage token encryption, OAuth initiation (openExternal), callback URL parsing, HTTP calls (refresh/me/revoke), state broadcast |
| `main/ipc.ts` | IPC handlers: `auth:get-state`, `auth:sign-in`, `auth:sign-out`, `auth:subscribe` + event `auth:state-changed` |
| `preload/types.ts` | `AuthAPI`, `AuthState`, `AuthUser` types |
| `preload/index.ts` | `window.api.auth = { getState, signIn, signOut, subscribe }` |
| `renderer/index.tsx` | Auth gate: wait for state → signedOut ? `<LoginScreen />` : `<AppInterface />` |
| `renderer/login.tsx` | Login page with Google button |
| `renderer/auth.ts` | `createAuthStore()` reactively wraps `window.api.auth` |
| `renderer/user-menu.tsx` | Avatar + dropdown (MenuV2) mounted into titlebar right via portal |

### New Files

```
packages/desktop/src/main/
  auth.ts              # Auth service
packages/desktop/src/renderer/
  login.tsx            # Login page
  auth.ts              # Auth store (state + subscribe)
  user-menu.tsx         # User avatar menu
```

### Modified Files

```
packages/desktop/src/main/
  index.ts             # itfs:// scheme, second-instance auth routing
  ipc.ts               # + auth IPC handlers
packages/desktop/src/preload/
  index.ts             # + window.api.auth
  types.ts             # + auth types
packages/desktop/src/renderer/
  i18n/en.ts           # + auth i18n keys
  i18n/vi.ts           # + Vietnamese translations
  i18n/*.ts            # + keys in all 28 locale files (parity)
  index.tsx            # Auth gate in DesktopRoot
packages/desktop/electron-builder.config.ts   # protocols: itfs
packages/app/src/pages/layout/
  deep-links.ts        # opencode:// → itfs://
  helpers.test.ts      # test URLs updated
```

## Component Details

### Token Storage (`main/auth.ts`)

- Device ID: UUID v4, generated once, stored as `userData/auth/device_id.txt` (plaintext — not a secret).
- Access token: encrypted via `safeStorage.encryptString()`, written to `userData/auth/access_token.enc`.
- Refresh token: encrypted via `safeStorage.encryptString()`, written to `userData/auth/refresh_token.enc`.
- User profile: stored as plain JSON in `userData/auth/user.json` (last-known profile for quick display; refreshed on startup).
- If `safeStorage.isEncryptionAvailable()` is false at any time, auth operations fail with error.

### API Endpoints Used

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/auth/google` | — | Initiate OAuth (open in system browser) |
| POST | `/api/v1/auth/refresh` | Bearer refresh | Validate + rotate tokens |
| GET | `/api/v1/auth/me` | Bearer access | Get user profile (avatar_url, fullname, email) |
| POST | `/api/v1/auth/revoke` | Bearer access | Revoke current device session |

### API Base URL

- Default: `http://localhost:3000`
- Override via `process.env.ITFS_API_URL` (readable at runtime in main process; set via env when running dev or baking into packaged build).

### OAuth Flow

1. Renderer → `window.api.auth.signIn()` → main `shell.openExternal(API_BASE + "/api/v1/auth/google")`
2. User signs in on Google in system browser
3. Backend redirects browser to `itfs://auth#access_token=...&refresh_token=...&device_id=...`
4. OS routes to Electron app (single instance lock or second-instance)
5. Main intercepts `open-url` / `second-instance` → if URL starts with `itfs://auth` → parse fragment, store tokens via safeStorage, call `GET /auth/me`, broadcast `auth:state-changed(signedIn, user)`
6. Renderer receives event → re-renders to main app

### Startup Validation Flow

1. Renderer mounts, calls `window.api.auth.getState()`
2. Main `loadSessionOnStartup()`:
   - Load encrypted tokens from disk
   - If no refresh token → return `{ status: "signedOut" }`
   - Call `POST /auth/refresh` (validate + token rotation)
   - Call `GET /auth/me` for user profile
   - On success → return `{ status: "signedIn", user }`
   - On failure → clear tokens, return `{ status: "signedOut" }`
3. Renderer shows `LoadingSplash` while loading → no flash
4. signedOut → `<LoginScreen />`; signedIn → `<AppInterface />`

### Sign-Out Flow

1. Renderer → `window.api.auth.signOut()`
2. Main POST `/auth/revoke` with Bearer access token + body `{ device_id }` (best-effort)
3. Clear local token files
4. Broadcast `auth:state-changed(signedOut)`
5. Renderer transitions to `<LoginScreen />`

### Refresh Token (On Expiry)

- The main process exposes `getValidAccessToken()` internally that checks JWT `exp` claim. If expired or near-expiry, calls `POST /auth/refresh` before proceeding with API calls.
- Access token live 15 min; refresh every 30 days with rotation (old hash deleted from backend).

### Login Page (`renderer/login.tsx`)

- Centered layout with background (`bg-background-base`).
- OpenCode logo/splash at top.
- "Continue with Google" button using `Button` component with inline Google "G" SVG.
- On click → `window.api.auth.signIn()` (open system browser).
- Error message displayed below button if callback returns error or encryption unavailable.
- Minimal drag region (`-webkit-app-region: drag`) for window movement on Windows frameless.

### User Menu (`renderer/user-menu.tsx`)

- Component rendered inside the app tree (as child of `AppInterface`), using `useTitlebarRightMount()` from `@opencode-ai/app` to portal into `#opencode-titlebar-right`.
- Trigger: user avatar from `AvatarV2` (`@opencode-ai/ui/v2/avatar-v2`), using `avatar_url` from profile or fallback initial from `fullname`.
- Menu (`MenuV2`):
  - Avatar + fullname + email (read-only group)
  - Separator
  - "Log out" item → calls `window.api.auth.signOut()`

## URL Scheme Change: `opencode://` → `itfs://`

Replace the protocol scheme in all relevant locations:

| Location | Change |
|---|---|
| `main/index.ts` `setAsDefaultProtocolClient` | `"opencode"` → `"itfs"` |
| `main/index.ts` `second-instance` argv filter | `startsWith("opencode://")` → `startsWith("itfs://")` |
| `electron-builder.config.ts` `protocols.schemes` (all 3 channels) | `["opencode"]` → `["itfs"]` |
| `app/pages/layout/deep-links.ts` parseUrl | `startsWith("opencode://")` → `startsWith("itfs://")` |
| `app/pages/layout/helpers.test.ts` | Test URLs `opencode://` → `itfs://` |

### Auth Callback vs Deep Link Routing

In main process, when a URL is received:

```
itfs://auth#access_token=...&refresh_token=...  → auth.handleAuthCallback(url)
itfs://auth?error=invalid_state                   → auth.handleAuthCallback(url)
itfs://open-project?directory=/foo                → deep link (emitDeepLinks)
itfs://new-session?directory=/foo                 → deep link
```

`emitDeepLinks` in `index.ts` is modified to filter auth URLs before pushing to pending deep links. The `open-url` event on macOS also routes through the same logic.

## i18n

Keys added to `packages/desktop/src/renderer/i18n/en.ts`:

| Key | English source |
|---|---|
| `desktop.auth.signIn.title` | Sign in |
| `desktop.auth.signIn.withGoogle` | Continue with Google |
| `desktop.auth.signIn.error.default` | Sign in failed. Please try again. |
| `desktop.auth.signIn.error.encryption` | Your system does not support secure storage. |
| `desktop.auth.userMenu.logout` | Log out |

All 28 desktop locale files require these keys (parity test enforces key presence). Non-English locales may keep the English value as fallback. Vietnamese (`vi.ts`) receives actual translations.

## Error Handling

| Scenario | Behavior |
|---|---|
| No tokens on startup | signedOut → login screen |
| Refresh/me fails on startup | Clear tokens, signedOut → login screen (no error message; normal expired session) |
| `itfs://auth?error=` callback | Parse error code, display message on login page |
| `safeStorage` unavailable | Error shown on login page when clicking sign-in |
| Revoke fails on logout | Still clear local tokens (best-effort), logout successful locally |
| API unreachable (network) | Show error on login page, allow retry |

## Testing Strategy

- `main/auth.ts`: Unit test token load/store/refresh logic (safeStorage can be tested via mock or skipped on CI).
- `app/pages/layout/helpers.test.ts`: Update deep link parsing tests from `opencode://` to `itfs://` scheme.
- Manual E2E: Launch app → login page → click Google → browser → complete → app transitions to main → avatar menu → logout → back to login.

## Implementation Order

1. **URL scheme** — Replace `opencode://` with `itfs://` everywhere (deep-links, electron-builder, main process).
2. **Token storage** — `main/auth.ts`: safeStorage-based encrypt/decrypt, device_id generation.
3. **Auth service** — `main/auth.ts`: refresh/me/revoke HTTP calls, callback handling.
4. **IPC + preload** — Auth handlers in `ipc.ts` + `window.api.auth` in preload + types.
5. **Login page** — `renderer/login.tsx` + auth gate in `renderer/index.tsx`.
6. **User menu** — `renderer/user-menu.tsx` with portal into titlebar right.
7. **i18n** — Add keys to all locale files + Vietnamese translations.
8. **Testing** — Update deep-link tests, verify integration manually.

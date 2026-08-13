# ITFS Interaction Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 320×600 always-on-top frameless window docked right of the main window while an ITFS interview is active, opened on `itfs_start_interview` and closed on complete/cancel/reset.

**Architecture:** The ITFS plugin runs in the opencode server sidecar (a non-Electron process). It signals the Electron main process over a loopback HTTP server (`itfs-window-server.ts`) whose ephemeral port is published via `process.env.ITFS_WINDOW_PORT` (same pattern as `itfs-token-server.ts`). The main process owns the `BrowserWindow`; geometry clamping lives in a pure module (`itfs-window-position.ts`) that is unit-testable without Electron.

**Tech Stack:** Electron (`BrowserWindow`, `screen`), Node `node:http`, Bun (`bun:test`), TypeScript. Spec: `docs/superpowers/specs/2026-08-13-itfs-interaction-window-design.md`.

## Global Constraints

- Desktop package `packages/desktop`; typecheck with `bun run typecheck` (runs `tsgo -b`). Tests use `bun:test`, run from `packages/desktop` with `bun test <file>`.
- Plugin package `packages/opencode`; typecheck with `bun run typecheck` (runs `tsgo --noEmit`).
- Do not run tests from the repo root.
- Window: width 320, height 600, `minWidth`/`minHeight` 200, `resizable: true`, `frame: false`, `alwaysOnTop: true`, `skipTaskbar: true`.
- The window's right edge must never cross the work area's right edge; width is never shrunk to fit the viewport.
- Loopback-only HTTP server (bind `127.0.0.1`), no auth (mirrors `itfs-token-server.ts`).
- Plugin signals are best-effort: a dead/missing window server must never fail the tool result; plugin is a no-op when `ITFS_WINDOW_PORT` is unset (TUI/web).
- Plugin signals only on backend success: `itfs_start_interview` → open; `itfs_complete_interview`, `itfs_reset_interview` → close; `itfs_cancel_interview` → close only when cancelling the active session (`iUuid === interviewUuid`).

---

### Task 1: `positionItfsWindow` pure geometry + tests

**Files:**
- Create: `packages/desktop/src/main/itfs-window-position.ts`
- Test: `packages/desktop/src/main/itfs-window-position.test.ts`

**Interfaces:**
- Produces:
  - `export type Rect = { x: number; y: number; width: number; height: number }`
  - `export function positionItfsWindow(bounds: Rect, workArea: Rect, size: { width: number; height: number }): { x: number; y: number }`

Rules: `x = Math.min(bounds.x + bounds.width, workArea.x + workArea.width - size.width)` (no lower clamp); `y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - size.height)`.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/main/itfs-window-position.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { positionItfsWindow } from "./itfs-window-position"

describe("positionItfsWindow", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 320, height: 600 }

  test("places the window just right of the main window when there is room", () => {
    const bounds = { x: 100, y: 100, width: 1280, height: 800 }
    expect(positionItfsWindow(bounds, workArea, size)).toEqual({ x: 1380, y: 100 })
  })

  test("keeps the right edge inside the viewport when the main window is near the right edge", () => {
    const bounds = { x: 620, y: 100, width: 1280, height: 800 }
    const pos = positionItfsWindow(bounds, workArea, size)
    expect(pos.x).toBe(1600)
    expect(pos.x + size.width).toBe(1920)
  })

  test("keeps the width when the work area is narrower than the window", () => {
    const narrow = { x: 0, y: 0, width: 200, height: 1080 }
    const bounds = { x: 100, y: 100, width: 1280, height: 800 }
    expect(positionItfsWindow(bounds, narrow, size).x).toBe(-120)
  })

  test("clamps y above the work area", () => {
    const bounds = { x: 100, y: -50, width: 1280, height: 800 }
    expect(positionItfsWindow(bounds, workArea, size).y).toBe(0)
  })

  test("clamps y so the bottom edge stays inside the work area", () => {
    const bounds = { x: 100, y: 900, width: 1280, height: 800 }
    expect(positionItfsWindow(bounds, workArea, size).y).toBe(480)
  })

  test("bottom-aligns when the work area is shorter than the window", () => {
    const short = { x: 0, y: 0, width: 1920, height: 400 }
    const bounds = { x: 100, y: 100, width: 1280, height: 800 }
    expect(positionItfsWindow(bounds, short, size).y).toBe(-200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test itfs-window-position.test.ts` (from `packages/desktop`)
Expected: FAIL — module `./itfs-window-position` not found / `positionItfsWindow` is not a function.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/desktop/src/main/itfs-window-position.ts`:

```ts
export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export function positionItfsWindow(
  bounds: Rect,
  workArea: Rect,
  size: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.min(bounds.x + bounds.width, workArea.x + workArea.width - size.width)
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - size.height)
  return { x, y }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test itfs-window-position.test.ts` (from `packages/desktop`)
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/itfs-window-position.ts packages/desktop/src/main/itfs-window-position.test.ts
git commit -m "feat(desktop): add ITFS window positioning geometry"
```

---

### Task 2: `itfs-window-server.ts` — window manager + loopback HTTP server

**Files:**
- Create: `packages/desktop/src/main/itfs-window-server.ts`

**Interfaces:**
- Consumes:
  - `positionItfsWindow`, `Rect` from `./itfs-window-position`
  - `getLastFocusedWindow` from `./windows`
- Produces:
  - `export function startItfsWindowServer(): Promise<number>` — resolves the ephemeral port once listening.
  - `export function closeItfsWindow(): void` — closes the window if open; no-op otherwise.
  - `openItfsWindow()` (internal) — idempotent open/show/reposition.

- [ ] **Step 1: Write the window manager + HTTP server**

Create `packages/desktop/src/main/itfs-window-server.ts`:

```ts
import { createServer } from "node:http"
import { BrowserWindow, screen } from "electron"
import { positionItfsWindow } from "./itfs-window-position"
import { getLastFocusedWindow } from "./windows"

const WINDOW_WIDTH = 320
const WINDOW_HEIGHT = 600
const MIN_WIDTH = 200
const MIN_HEIGHT = 200

let itfsWindow: BrowserWindow | null = null

function anchorWindow(): BrowserWindow | null {
  const focused = getLastFocusedWindow()
  if (focused && !focused.isDestroyed() && focused !== itfsWindow) return focused
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win !== itfsWindow) ?? null
}

function placeholderUrl() {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ITFS Interview</title>
<style>body{font-family:system-ui;background:#161616;color:#e8e8e8;margin:0;padding:16px}h1{font-size:14px;margin:0 0 8px}p{font-size:12px;color:#999}</style>
</head>
<body><h1>ITFS Interview</h1><p>Interaction log will appear here.</p></body>
</html>`
  return `data:text/html,${encodeURIComponent(html)}`
}

function openItfsWindow() {
  const anchor = anchorWindow()
  if (!anchor) return
  const workArea = screen.getDisplayMatching(anchor.getBounds()).workArea
  if (itfsWindow && !itfsWindow.isDestroyed()) {
    const bounds = itfsWindow.getBounds()
    const { x, y } = positionItfsWindow(anchor.getBounds(), workArea, {
      width: bounds.width,
      height: bounds.height,
    })
    itfsWindow.setPosition(x, y)
    itfsWindow.show()
    return
  }
  const { x, y } = positionItfsWindow(anchor.getBounds(), workArea, {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })
  const win = new BrowserWindow({
    x,
    y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    resizable: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
  })
  win.once("closed", () => {
    itfsWindow = null
  })
  anchor.once("closed", closeItfsWindow)
  void win.loadURL(placeholderUrl())
  win.once("ready-to-show", () => win.show())
  itfsWindow = win
}

export function closeItfsWindow() {
  if (!itfsWindow || itfsWindow.isDestroyed()) {
    itfsWindow = null
    return
  }
  itfsWindow.close()
  itfsWindow = null
}

export function startItfsWindowServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Method not allowed" }))
        return
      }
      let body = ""
      for await (const chunk of req) body += chunk
      const parsed = parseWindowBody(body)
      if (!parsed) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Expected { open: boolean }" }))
        return
      }
      if (parsed.open) openItfsWindow()
      else closeItfsWindow()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
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

function parseWindowBody(body: string): { open: boolean } | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const open = (value as { open?: unknown }).open
  return typeof open === "boolean" ? { open } : null
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` (from `packages/desktop`)
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/main/itfs-window-server.ts
git commit -m "feat(desktop): add ITFS interaction window server"
```

---

### Task 3: Wire the window server into the desktop main process

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `startItfsWindowServer`, `closeItfsWindow` from `./itfs-window-server`.

- [ ] **Step 1: Import the window server**

In `packages/desktop/src/main/index.ts`, add to the existing import block (after the `startItfsTokenServer` import at line 51):

```ts
import { closeItfsWindow, startItfsWindowServer } from "./itfs-window-server"
```

- [ ] **Step 2: Start the server and publish the port before the sidecar spawns**

Inside `loadingTask`, directly after the `itfsTokenPort` block (after line 354, `logger.log("itfs token server started", ...)`), add:

```ts
const itfsWindowPort = yield* Effect.promise(() => startItfsWindowServer())
process.env.ITFS_WINDOW_PORT = String(itfsWindowPort)
logger.log("itfs window server started", { port: itfsWindowPort })
```

- [ ] **Step 3: Close the window on app quit**

Modify the existing `app.on("before-quit", ...)` handler (line 235) to:

```ts
app.on("before-quit", () => {
  setAppQuitting()
  closeItfsWindow()
  void stopSidecars()
})
```

Modify the existing `app.on("will-quit", ...)` handler (line 240) to:

```ts
app.on("will-quit", () => {
  setAppQuitting()
  closeItfsWindow()
  void stopSidecars()
})
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck` (from `packages/desktop`)
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): start ITFS window server and close window on quit"
```

---

### Task 4: Plugin lifecycle signals (`itfs.ts`)

**Files:**
- Modify: `packages/opencode/src/plugin/itfs.ts`

**Interfaces:**
- Produces:
  - `async function notifyWindow(open: boolean)` — module-private; POSTs `{ open }` to `http://localhost:<ITFS_WINDOW_PORT>/window` when the env port is set, never throws.
- Consumes: nothing (module env const only).

- [ ] **Step 1: Add the window port env read**

In `packages/opencode/src/plugin/itfs.ts`, after the `TOKEN_PORT` const (line 6), add:

```ts
const ITFS_WINDOW_PORT = process.env.ITFS_WINDOW_PORT ? parseInt(process.env.ITFS_WINDOW_PORT) : null
```

- [ ] **Step 2: Add the `notifyWindow` helper**

After the `apiRequest` function (after line 55), add:

```ts
async function notifyWindow(open: boolean) {
  if (!ITFS_WINDOW_PORT) return
  try {
    await fetch(`http://localhost:${ITFS_WINDOW_PORT}/window`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open }),
    })
  } catch {
    // best-effort: a dead window server must not fail the tool
  }
}
```

- [ ] **Step 3: Notify on interview start**

In `itfs_start_interview.execute`, after `interviewUuid = data.interview.uuid` (line 137), add:

```ts
await notifyWindow(true)
```

- [ ] **Step 4: Notify on interview complete**

In `itfs_complete_interview.execute`, after `currentQaUuid = null` (line 244), add:

```ts
await notifyWindow(false)
```

- [ ] **Step 5: Notify on cancel of the active session**

In `itfs_cancel_interview.execute`, inside the `if (iUuid === interviewUuid)` block, after `currentQaUuid = null` (line 262), add:

```ts
await notifyWindow(false)
```

- [ ] **Step 6: Notify on reset**

In `itfs_reset_interview.execute`, after `currentQaUuid = null` (line 279), add:

```ts
await notifyWindow(false)
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck` (from `packages/opencode`)
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/plugin/itfs.ts
git commit -m "feat(plugin): open and close ITFS interaction window with interview lifecycle"
```

---

### Task 5: Manual verification (desktop)

No code. Verifies the acceptance criteria for this scope (open/close timing + always-on-top).

- [ ] **Step 1: Run the app**

From `packages/desktop`, run `bun dev` (predev syncs the ITFS skills). Start the ITFS backend on `localhost:3000` and make sure a token is available (the token server listens on the port published to `ITFS_TOKEN_PORT`).

- [ ] **Step 2: Verify the window opens**

In a session, ask the agent to call `itfs_start_interview` (e.g. with any `skill_id` and `target_level`). Confirm a frameless 320×600 window appears just right of the main window, its right edge inside the viewport, with a "ITFS Interview" placeholder page.

- [ ] **Step 3: Verify always-on-top**

Bring another application to the front and confirm the ITFS window stays on top. Drag the window and confirm it moves freely.

- [ ] **Step 4: Verify close on complete**

Ask the agent to call `itfs_complete_interview` (with `skill_name`, `level`, `raw_level_status`). Confirm the window closes.

- [ ] **Step 5: Verify close on cancel**

Start another interview, then ask the agent to call `itfs_cancel_interview`. Confirm the window closes.

- [ ] **Step 6: Verify TUI no-op**

Run the TUI (`bun dev` from `packages/opencode`). Start an interview; confirm no window appears and the tools still succeed — `notifyWindow` silently no-ops because `ITFS_WINDOW_PORT` is unset.

---

## Self-Review

- **Spec coverage:** Task 1 = geometry rules + unit tests; Task 2 = window server (HTTP, open/close, idempotent, placeholder, anchor-close); Task 3 = env plumbing + quit cleanup; Task 4 = all four lifecycle notify points + best-effort no-op; Task 5 = manual verification incl. always-on-top and TUI no-op. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; every step has concrete code or exact commands with expected output.
- **Type consistency:** `positionItfsWindow(bounds, workArea, size)` returns `{ x, y }`, used identically in Task 2. `Rect` type imported only by the pure module. `notifyWindow(open: boolean)` matches all four call sites. `startItfsWindowServer`/`closeItfsWindow` names match Task 2 → Task 3.

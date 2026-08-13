# ITFS Interaction Window

## Summary

When an ITFS interview starts, the OpenCode desktop app shows a small always-on-top
frameless window (default 320×600) docked just right of the main window. The window
lives for the duration of the interview and is closed when the interview completes,
is cancelled, or is reset. The current scope only verifies that the window opens and
closes at the right times and that always-on-top works; the window content is a static
placeholder (the interaction log display is future work).

## Context

The ITFS plugin (`packages/opencode/src/plugin/itfs.ts`) runs inside the opencode
server, which in the desktop app lives in a separate utility process (the sidecar),
not the Electron main process. The plugin therefore cannot create windows directly.

The desktop app already integrates with ITFS through a loopback HTTP server
(`packages/desktop/src/main/itfs-token-server.ts`) whose port is published to the
plugin via `process.env.ITFS_TOKEN_PORT`. This design reuses that exact pattern.

Future intent (not in scope, but the architecture must support it):

- The renderer (main window) captures DOM events during an interview: `keyup` on the
  prompt input (typing speed), `paste`, `copy` on the window, `blur`/`focus`.
- These events are logged via the ITFS API and shown live in the frameless window.

Both future pieces stay inside the desktop renderer + ITFS backend; the opencode server
only runs the plugin tools (interview lifecycle) and signals the desktop to show/hide
the window. No opencode event-manifest or SDK changes are needed.

## Architecture

```
┌──────────────────────────── Sidecar (opencode server) ───────────────────────────┐
│  itfs.ts (plugin)                                                                │
│   itfs_start_interview        ── success ──► POST localhost:ITFS_WINDOW_PORT {open:true} │
│   itfs_complete_interview ─┐                                                     │
│   itfs_cancel_interview  ──┤ success ──► POST {open:false}                        │
│   itfs_reset_interview   ──┘                                                     │
└────────────────────────────────│─────────────────────────────────────────────────┘
                                 │ HTTP loopback (127.0.0.1)
                                 ▼
┌──────────────────────────── Electron main ────────────────────────────────────────┐
│  itfs-window-server.ts   HTTP server; port → process.env.ITFS_WINDOW_PORT;        │
│                          open/close BrowserWindow 320×600, alwaysOnTop,           │
│                          positioned right of the main window, clamped in workArea│
└────────────────────────────────│─────────────────────────────────────────────────┘
                                 ▼
┌─────────── Renderer main window (future) ──────────┐ ┌──── Frameless window (future) ────┐
│  keyup/paste/copy/blur/focus → POST ITFS API       │ │  fetch token → read log from ITFS API│
└────────────────────────────────────────────────────┘ └────────────────────────────────────┘
```

Signal flow: plugin → HTTP POST to the window server → Electron main opens/closes the
BrowserWindow. The plugin is a no-op when `ITFS_WINDOW_PORT` is unset (TUI/web), so the
feature is desktop-only without breaking other surfaces.

## Plugin changes (`packages/opencode/src/plugin/itfs.ts`)

- Add `const ITFS_WINDOW_PORT = process.env.ITFS_WINDOW_PORT ? parseInt(...) : null`
  (mirrors `ITFS_TOKEN_PORT`).
- Add a best-effort helper:

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
      // best-effort; a dead window server must not fail the tool
    }
  }
  ```

- Call it only when the backend call succeeded (state actually changed):
  - `itfs_start_interview` success → `notifyWindow(true)`
  - `itfs_complete_interview` success → `notifyWindow(false)`
  - `itfs_reset_interview` success → `notifyWindow(false)`
  - `itfs_cancel_interview` success **and** `iUuid === interviewUuid` (cancelling the
    active session) → `notifyWindow(false)`; cancelling some other interview by UUID
    must not touch the window.
- Do not notify in `itfs_ask_question`, `itfs_record_answer`, `itfs_score_answer`,
  `itfs_record_skip` (they do not change the interview lifecycle).

## Desktop main window server (`packages/desktop/src/main/itfs-window-server.ts`, new)

Self-contained file mirroring `itfs-token-server.ts`:

- `startItfsWindowServer(): Promise<number>` — HTTP server bound to `127.0.0.1` on an
  ephemeral port. Handles `POST /window` with JSON `{ open: boolean }`; validates the
  body (400 on malformed input). `open: true` → `openItfsWindow()`, `open: false` →
  `closeItfsWindow()`; responds `{ ok: true }`. Loopback-only, no auth (same as the
  token server).
- Module-private `openItfsWindow()` / `closeItfsWindow()`:
  - Window options: `{ width: 320, height: 600, minWidth: 200, minHeight: 200,
    resizable: true, frame: false, alwaysOnTop: true, skipTaskbar: true, show: false }`.
  - Loads a static placeholder page via a `data:` URL.
  - Positioning: take the main window bounds (`getLastFocusedWindow()`, falling back to
    another live window that is not the ITFS window) and
    `screen.getDisplayMatching(bounds).workArea`.
  - Idempotent: opening when the window already exists only shows + repositions it
    (covers the case where the main window moved); closing when there is none is a no-op.
  - `win.on("closed")` clears the module-level reference.
- Export pure function `positionItfsWindow(bounds, workArea, size)` for unit testing.

### Positioning rules

- Width/height are never shrunk to fit the viewport.
- `x = Math.min(mainWin.x + mainWin.width, workArea.x + workArea.width - width)` — the
  window's right edge never crosses the work area's right edge. If there is not enough
  room, the frame shifts left, overlapping the main window (the user can drag it).
  There is no lower clamp on `x`; if the work area is narrower than the window, the
  window may extend past the work area's left edge.
- `y = Math.min(Math.max(mainWin.y, workArea.y), workArea.bottom - height)` — aligned
  with the main window's top, kept within the work area vertically (top-aligned if the
  work area is shorter than the window).

## Plumbing (`packages/desktop/src/main/index.ts`)

- Start the window server next to the token server, before the sidecar is spawned, and
  publish the port:
  `process.env.ITFS_WINDOW_PORT = String(port)` (inherited by the sidecar env, so it
  works for both sidecar v1 and v2).
- Register `app.on("before-quit")` / `app.on("will-quit")` → `closeItfsWindow()` so the
  window is torn down even if the sidecar dies without sending the close POST.
- When all main windows close while the ITFS window is still open, close the ITFS
  window too (prevents the app from lingering because a window still exists).

## Edge cases

- Sidecar dies / quits without a close POST → app-quit cleanup closes the window.
- All main windows close but the ITFS window remains → close the ITFS window.
- Repeated `open` (tool retried) → idempotent show + reposition.
- `itfs_cancel_interview` for a non-active interview (by UUID) → no window change.
- TUI/web (`ITFS_WINDOW_PORT` unset) → plugin no-op, no errors.

## Testing

### Unit tests (`itfs-window.test.ts`)

`positionItfsWindow`:

- Enough room to the right: `mainWin.right = 1380`, work area width 1920 → `x = 1380`,
  right edge 1700 ≤ 1920.
- Main window near the right edge (`mainWin.right = 1900`) → `x = 1600` (right edge =
  1920), window overlaps the main window, width stays 320.
- Work area narrower than the window (e.g. 200 < 320) → `x` shifts left past the work
  area's left edge, width stays 320.
- `y` clamps above/below the work area.

### Manual verification (desktop)

- Run `bun dev` from `packages/desktop` with the ITFS backend on `localhost:3000`.
- Have the agent call `itfs_start_interview` → the window appears (320×600) right of the
  main window, always on top (bring another app to the front and confirm it stays on
  top), right edge inside the viewport.
- `itfs_complete_interview` and `itfs_cancel_interview` → the window closes.
- Run the TUI → no window appears, no errors.

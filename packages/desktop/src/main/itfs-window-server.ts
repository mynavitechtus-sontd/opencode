import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { BrowserWindow, screen } from "electron"
import { positionItfsWindow } from "./itfs-window-position"
import { getLastFocusedWindow } from "./windows"

const WINDOW_WIDTH = 320
const WINDOW_HEIGHT = 600
const MIN_WIDTH = 200
const MIN_HEIGHT = 200

let itfsWindow: BrowserWindow | null = null
const hookedAnchors = new WeakSet<BrowserWindow>()

function anchorWindow(): BrowserWindow | null {
  const focused = getLastFocusedWindow()
  if (focused && !focused.isDestroyed() && focused !== itfsWindow) return focused
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win !== itfsWindow) ?? null
}

function placeholderUrl() {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ITFS Interview</title>
<style>body{font-family:system-ui;background:#ffffff;color:#111111;margin:0;padding:16px;-webkit-app-region:drag}h1{font-size:14px;margin:0 0 8px}p{font-size:12px;color:#666}</style>
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
  if (!hookedAnchors.has(anchor)) {
    hookedAnchors.add(anchor)
    anchor.once("closed", closeItfsWindow)
  }
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
    const server = createServer((req, res) => {
      void handleWindowRequest(req, res).catch(() => {
        if (res.headersSent) return
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal error" }))
      })
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

async function handleWindowRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Method not allowed" }))
    return
  }
  if (req.url !== "/window") {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
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

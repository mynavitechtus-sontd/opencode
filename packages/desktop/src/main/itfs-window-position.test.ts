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

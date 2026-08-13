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

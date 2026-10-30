export interface Rect
{
  x: number
  y: number
  w: number
  h: number
}

export type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export type DragMode = ResizeEdge | 'move'

export interface LayoutOptions
{
  others: Rect[]
  bounds: { w: number, h: number }
  minW: number
  minH: number
  grid: number
}

export function hits(a: Rect, b: Rect): boolean
{
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function overlapped(rect: Rect, others: Rect[]): boolean
{
  return others.some((other) => hits(rect, other))
}

export function clampScale(width: number, designWidth: number): number
{
  if (width >= designWidth) return 1
  return Math.max(0.55, width / designWidth)
}

function spanOverlap(a: { y: number, h: number }, b: { y: number, h: number }): boolean
{
  return a.y < b.y + b.h && b.y < a.y + a.h
}

function crossOverlap(a: { x: number, w: number }, b: { x: number, w: number }): boolean
{
  return a.x < b.x + b.w && b.x < a.x + a.w
}

function gridFloor(value: number, grid: number): number
{
  const step = grid || 1
  return Math.floor(value / step) * step
}

function gridCeil(value: number, grid: number): number
{
  const step = grid || 1
  return Math.ceil(value / step) * step
}

function snapToward(value: number, origin: number, grid: number): number
{
  if (value === origin) return value
  return value > origin ? gridFloor(value, grid) : gridCeil(value, grid)
}

function slideX(from: Rect, target: number, others: Rect[]): number
{
  let x = target
  if (x > from.x)
  {
    for (const other of others)
    {
      if (!spanOverlap(from, other)) continue
      if (from.x + from.w <= other.x && other.x - from.w < x) x = other.x - from.w
    }
  }
  else if (x < from.x)
  {
    for (const other of others)
    {
      if (!spanOverlap(from, other)) continue
      if (other.x + other.w <= from.x && other.x + other.w > x) x = other.x + other.w
    }
  }
  return x
}

function slideY(from: Rect, target: number, others: Rect[]): number
{
  let y = target
  if (y > from.y)
  {
    for (const other of others)
    {
      if (!crossOverlap(from, other)) continue
      if (from.y + from.h <= other.y && other.y - from.h < y) y = other.y - from.h
    }
  }
  else if (y < from.y)
  {
    for (const other of others)
    {
      if (!crossOverlap(from, other)) continue
      if (other.y + other.h <= from.y && other.y + other.h > y) y = other.y + other.h
    }
  }
  return y
}

export function moveRect(base: Rect, dx: number, dy: number, options: LayoutOptions): Rect
{
  const { others, bounds, grid } = options
  const step = grid || 1
  const maxX = Math.max(0, bounds.w - base.w)
  const maxY = Math.max(0, bounds.h - base.h)
  const tx = bounds.w ? Math.min(Math.max(base.x + dx, 0), maxX) : base.x + dx
  const ty = bounds.h ? Math.min(Math.max(base.y + dy, 0), maxY) : base.y + dy
  const rawX = slideX(base, tx, others)
  let x = Math.round(rawX / step) * step
  if (x < 0 || x > maxX || overlapped({ ...base, x }, others)) x = snapToward(rawX, base.x, grid)
  const probe = { ...base, x }
  const rawY = slideY(probe, ty, others)
  let y = Math.round(rawY / step) * step
  if (y < 0 || y > maxY || overlapped({ ...probe, y }, others)) y = snapToward(rawY, base.y, grid)
  return { ...base, x, y }
}

function clampRight(base: Rect, target: Rect, others: Rect[]): number
{
  let right = target.x + target.w
  const span = { y: Math.min(base.y, target.y), h: Math.max(base.y + base.h, target.y + target.h) - Math.min(base.y, target.y) }
  for (const other of others)
  {
    if (!spanOverlap(span, other)) continue
    if (base.x + base.w <= other.x && other.x < right) right = other.x
  }
  return Math.max(right, base.x + 1)
}

function clampLeft(base: Rect, target: Rect, others: Rect[]): number
{
  let left = target.x
  const span = { y: Math.min(base.y, target.y), h: Math.max(base.y + base.h, target.y + target.h) - Math.min(base.y, target.y) }
  for (const other of others)
  {
    if (!spanOverlap(span, other)) continue
    if (other.x + other.w <= base.x && other.x + other.w > left) left = other.x + other.w
  }
  return Math.min(left, base.x + base.w - 1)
}

function clampBottom(base: Rect, target: Rect, others: Rect[]): number
{
  let bottom = target.y + target.h
  const span = { x: Math.min(base.x, target.x), w: Math.max(base.x + base.w, target.x + target.w) - Math.min(base.x, target.x) }
  for (const other of others)
  {
    if (!crossOverlap(span, other)) continue
    if (base.y + base.h <= other.y && other.y < bottom) bottom = other.y
  }
  return Math.max(bottom, base.y + 1)
}

function clampTop(base: Rect, target: Rect, others: Rect[]): number
{
  let top = target.y
  const span = { x: Math.min(base.x, target.x), w: Math.max(base.x + base.w, target.x + target.w) - Math.min(base.x, target.x) }
  for (const other of others)
  {
    if (!crossOverlap(span, other)) continue
    if (other.y + other.h <= base.y && other.y + other.h > top) top = other.y + other.h
  }
  return Math.min(top, base.y + base.h - 1)
}

export function resizeRect(base: Rect, mode: DragMode, dx: number, dy: number, options: LayoutOptions): Rect | null
{
  const { others, bounds, minW, minH, grid } = options
  const target: Rect = { ...base }
  if (mode.includes('e')) target.w = base.w + dx
  if (mode.includes('s')) target.h = base.h + dy
  if (mode.includes('w'))
  {
    target.x = base.x + dx
    target.w = base.w - dx
  }
  if (mode.includes('n'))
  {
    target.y = base.y + dy
    target.h = base.h - dy
  }
  const out: Rect = { ...base }
  if (mode.includes('e'))
  {
    const right = snapToward(clampRight(base, target, others), base.x + base.w, grid)
    out.w = Math.max(right - base.x, minW)
  }
  if (mode.includes('s'))
  {
    const bottom = snapToward(clampBottom(base, target, others), base.y + base.h, grid)
    out.h = Math.max(bottom - base.y, minH)
  }
  if (mode.includes('w'))
  {
    const left = snapToward(clampLeft(base, target, others), base.x, grid)
    const width = Math.max(base.x + base.w - left, minW)
    out.x = base.x + base.w - width
    out.w = width
  }
  if (mode.includes('n'))
  {
    const top = snapToward(clampTop(base, target, others), base.y, grid)
    const height = Math.max(base.y + base.h - top, minH)
    out.y = base.y + base.h - height
    out.h = height
  }
  if (bounds.w)
  {
    if (out.w > bounds.w) out.w = bounds.w
    if (out.x < 0)
    {
      out.w += out.x
      out.x = 0
    }
    if (out.x + out.w > bounds.w) out.w = bounds.w - out.x
  }
  if (bounds.h)
  {
    if (out.h > bounds.h) out.h = bounds.h
    if (out.y < 0)
    {
      out.h += out.y
      out.y = 0
    }
    if (out.y + out.h > bounds.h) out.h = bounds.h - out.y
  }
  if (out.w < minW || out.h < minH) return null
  if (overlapped(out, others)) return null
  return out
}

export function resolveRect(base: Rect, mode: DragMode, dx: number, dy: number, options: LayoutOptions): Rect | null
{
  if (mode === 'move') return moveRect(base, dx, dy, options)
  return resizeRect(base, mode, dx, dy, options)
}

import { clamp, type Span } from './clips'
import type { TrimEdge } from './scrubber'

/** Seconds of context shown on each side of the clip, at least. */
const MIN_PAD = 2
/** A handle closer than this share of the window to its edge recenters the window on drop. */
const RECENTER_SHARE = 0.1
/** Width of each orange handle; the handles sit just outside the clip region. */
const TRIM_HANDLE_PX = 8
/** Pointer distance from a handle's centre that still grabs it. */
const TRIM_HIT_PX = 12

/** The stretch of the source the trim strip shows: the clip with padding, inside the source. */
export function trimWindow(clip: Span, duration: number): Span {
  const pad = Math.max(MIN_PAD, (clip.end - clip.start) / 2)
  const end = Math.max(0, duration)
  return { start: clamp(clip.start - pad, 0, end), end: clamp(clip.end + pad, 0, end) }
}

const lengthOf = (window: Span) => window.end - window.start

export function timeAtX(x: number, width: number, window: Span): number {
  if (width <= 0 || lengthOf(window) <= 0) return window.start
  return window.start + (clamp(x, 0, width) / width) * lengthOf(window)
}

export function xOfTime(t: number, width: number, window: Span): number {
  if (lengthOf(window) <= 0) return 0
  return ((clamp(t, window.start, window.end) - window.start) / lengthOf(window)) * width
}

/** True when either clip edge has come within 10% of the window's edge. */
export function shouldRecenter(clip: Span, window: Span): boolean {
  const margin = lengthOf(window) * RECENTER_SHARE
  return clip.start - window.start < margin || window.end - clip.end < margin
}

/** The handle under `x`, if any. The start handle sits left of the clip, the end handle right. */
export function handleAt(x: number, width: number, window: Span, clip: Span): TrimEdge | null {
  const half = TRIM_HANDLE_PX / 2
  const fromStart = Math.abs(x - (xOfTime(clip.start, width, window) - half))
  const fromEnd = Math.abs(x - (xOfTime(clip.end, width, window) + half))
  if (Math.min(fromStart, fromEnd) > TRIM_HIT_PX) return null
  return fromStart <= fromEnd ? 'start' : 'end'
}

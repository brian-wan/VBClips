import {
  MIN_CLIP_LENGTH,
  canSetEnd,
  canSetStart,
  clamp,
  clampToDuration,
  roundTime,
  type Span,
} from './clips'
import { pointerTolerance, type PointerTolerance } from './pointer'

/** Extra px around very short clip segments so they stay clickable. */
const CLIP_HIT_SLOP_PX = 2

export type TrimEdge = 'start' | 'end'

export type ScrubberTarget =
  | { kind: 'handle'; edge: TrimEdge }
  | { kind: 'playhead' }
  | { kind: 'clip'; id: string }
  | { kind: 'track' }

export function percentOf(t: number, duration: number): number {
  return duration > 0 ? (clampToDuration(t, duration) / duration) * 100 : 0
}

export function timeAtX(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0
  return (clamp(x, 0, width) / width) * duration
}

export function xOfTime(t: number, width: number, duration: number): number {
  return (percentOf(t, duration) / 100) * width
}

type HitInput = {
  x: number
  width: number
  duration: number
  clips: readonly (Span & { id: string })[]
  selectedId: string | null
  /** Local playhead time, or null when the playhead is in another source. */
  playhead: number | null
  /** Handle and playhead grab distances; the current pointer's when left out. */
  tolerance?: PointerTolerance
}

/**
 * What a pointer at `x` grabs, in priority order: the selected clip's trim handles, the playhead,
 * a clip segment (the last drawn wins where clips overlap), then the bare track.
 */
export function hitTest({
  x,
  width,
  duration,
  clips,
  selectedId,
  playhead,
  tolerance = pointerTolerance(),
}: HitInput): ScrubberTarget {
  if (width <= 0 || duration <= 0) return { kind: 'track' }
  const toX = (t: number) => xOfTime(t, width, duration)

  const selected = clips.find((c) => c.id === selectedId)
  if (selected) {
    const startX = toX(selected.start)
    const endX = toX(selected.end)
    const fromStart = Math.abs(x - startX)
    const fromEnd = Math.abs(x - endX)
    if (Math.min(fromStart, fromEnd) <= tolerance.handle) {
      return { kind: 'handle', edge: fromStart <= fromEnd ? 'start' : 'end' }
    }
  }

  if (playhead !== null && Math.abs(x - toX(playhead)) <= tolerance.playhead) {
    return { kind: 'playhead' }
  }

  // Later clips draw on top, so they win the hit test.
  for (const clip of [...clips].reverse()) {
    if (x >= toX(clip.start) - CLIP_HIT_SLOP_PX && x <= toX(clip.end) + CLIP_HIT_SLOP_PX) {
      return { kind: 'clip', id: clip.id }
    }
  }
  return { kind: 'track' }
}

/**
 * The clip with one edge dragged toward `t`. The edge stops at the nearest time the clip editor
 * would accept (start ≥ 0, end ≤ duration, length ≥ 0.2 s) instead of jumping or vanishing.
 */
export function trimClip<C extends Span>(clip: C, edge: TrimEdge, t: number, duration: number): C {
  if (edge === 'start') {
    const start = clamp(roundTime(t), 0, clip.end - MIN_CLIP_LENGTH)
    return canSetStart(clip, start) ? { ...clip, start } : clip
  }
  const end = clamp(roundTime(t), clip.start + MIN_CLIP_LENGTH, duration)
  return canSetEnd(clip, end, duration) ? { ...clip, end } : clip
}

export function edgeTime(clip: Span, edge: TrimEdge): number {
  return edge === 'start' ? clip.start : clip.end
}

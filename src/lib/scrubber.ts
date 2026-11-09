import {
  MIN_CLIP_LENGTH,
  canSetEnd,
  canSetStart,
  clamp,
  clampToDuration,
  roundTime,
  type Clip,
} from './clips'

/** Pointer distance in px from a selected clip's edge that still grabs its trim handle. */
export const HANDLE_HIT_PX = 8
/** Pointer distance in px from the playhead that grabs it for scrubbing. */
export const PLAYHEAD_HIT_PX = 6
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
  clips: readonly Clip[]
  selectedId: string | null
  playhead: number
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
}: HitInput): ScrubberTarget {
  if (width <= 0 || duration <= 0) return { kind: 'track' }
  const toX = (t: number) => xOfTime(t, width, duration)

  const selected = clips.find((c) => c.id === selectedId)
  if (selected) {
    const startX = toX(selected.start)
    const endX = toX(selected.end)
    const fromStart = Math.abs(x - startX)
    const fromEnd = Math.abs(x - endX)
    if (Math.min(fromStart, fromEnd) <= HANDLE_HIT_PX) {
      return { kind: 'handle', edge: fromStart <= fromEnd ? 'start' : 'end' }
    }
  }

  if (Math.abs(x - toX(playhead)) <= PLAYHEAD_HIT_PX) return { kind: 'playhead' }

  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i]
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
export function trimClip(clip: Clip, edge: TrimEdge, t: number, duration: number): Clip {
  if (edge === 'start') {
    const start = clamp(roundTime(t), 0, clip.end - MIN_CLIP_LENGTH)
    return canSetStart(clip, start) ? { ...clip, start } : clip
  }
  const end = clamp(roundTime(t), clip.start + MIN_CLIP_LENGTH, duration)
  return canSetEnd(clip, end, duration) ? { ...clip, end } : clip
}

export function edgeTime(clip: Clip, edge: TrimEdge): number {
  return edge === 'start' ? clip.start : clip.end
}

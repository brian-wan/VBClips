import type { Span } from './clips'

/** Any clip-like span; the editor passes clips in sequence time so they cross sources. */
type NavClip = Span & { id: string }

const PREV_RESTART_WINDOW = 1
const EPSILON = 1e-3

/**
 * The clip the playhead is "in" for navigation: the selected clip when the playhead is within it,
 * otherwise the last clip starting at or before the playhead.
 */
export function currentClipIndex(
  clips: readonly NavClip[],
  playhead: number,
  selectedId: string | null,
): number {
  const selected = clips.findIndex((c) => c.id === selectedId)
  if (selected >= 0) {
    const clip = clips[selected]
    if (playhead >= clip.start - EPSILON && playhead <= clip.end + EPSILON) return selected
  }
  let index = -1
  clips.forEach((clip, i) => {
    if (clip.start <= playhead + EPSILON) index = i
  })
  return index
}

/** Next clip after the current one; wraps to the first after the last. Expects sorted clips. */
export function nextClipIndex(
  clips: readonly NavClip[],
  playhead: number,
  selectedId: string | null,
): number {
  if (clips.length === 0) return -1
  const current = currentClipIndex(clips, playhead, selectedId)
  if (current < 0) return 0
  return (current + 1) % clips.length
}

/**
 * Music-player rule: within the first second of the current clip go to the previous clip,
 * otherwise restart the current clip. Never wraps backwards. Expects sorted clips.
 */
export function prevClipIndex(
  clips: readonly NavClip[],
  playhead: number,
  selectedId: string | null,
): number {
  if (clips.length === 0) return -1
  const current = currentClipIndex(clips, playhead, selectedId)
  if (current < 0) return 0
  if (playhead - clips[current].start > PREV_RESTART_WINDOW) return current
  return Math.max(0, current - 1)
}

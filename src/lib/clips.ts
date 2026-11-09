export type Clip = { id: string; start: number; end: number }

export const MIN_CLIP_LENGTH = 0.2
export const MANUAL_CLIP_LENGTH = 2
export const FRAME_DURATION = 1 / 30
const EPSILON = 1e-6

export function clamp(t: number, min: number, max: number): number {
  if (!Number.isFinite(t)) return min
  return Math.min(Math.max(t, min), max)
}

export function clampToDuration(t: number, duration: number): number {
  return clamp(t, 0, Math.max(0, duration))
}

export function clipDuration(clip: Pick<Clip, 'start' | 'end'>): number {
  return clip.end - clip.start
}

export function isValidSpan(start: number, end: number): boolean {
  return end - start >= MIN_CLIP_LENGTH - EPSILON
}

export function sortClips(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start || a.end - b.end)
}

export function insertClip(clips: readonly Clip[], clip: Clip): Clip[] {
  return sortClips([...clips, clip])
}

export function replaceClip(clips: readonly Clip[], clip: Clip): Clip[] {
  return sortClips(clips.map((c) => (c.id === clip.id ? clip : c)))
}

export function removeClip(clips: readonly Clip[], id: string): Clip[] {
  return clips.filter((c) => c.id !== id)
}

export function clipsOverlap(a: Clip, b: Clip): boolean {
  return a.start < b.end && b.start < a.end
}

/** Ids of every clip that overlaps at least one other clip. */
export function findOverlappingIds(clips: readonly Clip[]): Set<string> {
  const ids = new Set<string>()
  const sorted = sortClips(clips)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      ids.add(sorted[i].id)
      ids.add(sorted[j].id)
    }
  }
  return ids
}

/** Union of all clip spans; touching or overlapping clips become one segment. */
export function mergeOverlaps(clips: readonly Clip[]): { start: number; end: number }[] {
  const merged: { start: number; end: number }[] = []
  for (const clip of sortClips(clips)) {
    const last = merged[merged.length - 1]
    if (last && clip.start <= last.end) {
      last.end = Math.max(last.end, clip.end)
    } else {
      merged.push({ start: clip.start, end: clip.end })
    }
  }
  return merged
}

/** Length of the video the join step would produce (overlaps counted once). */
export function totalClippedDuration(clips: readonly Clip[]): number {
  return mergeOverlaps(clips).reduce((sum, seg) => sum + clipDuration(seg), 0)
}

/** Span for the "+" button: 2 s from the playhead, shifted back if it would run past the end. */
export function manualClipSpan(playhead: number, duration: number): { start: number; end: number } {
  const end = Math.min(playhead + MANUAL_CLIP_LENGTH, duration)
  const start = Math.max(0, Math.min(playhead, end - MANUAL_CLIP_LENGTH))
  return { start, end }
}

export function canSetStart(clip: Clip, start: number): boolean {
  return start >= -EPSILON && isValidSpan(start, clip.end)
}

export function canSetEnd(clip: Clip, end: number, duration: number): boolean {
  return end <= duration + EPSILON && isValidSpan(clip.start, end)
}

/** Rounds away float noise from nudges like 0.1 + 0.2. */
export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000
}

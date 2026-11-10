/** A marked point. `start` and `end` are in its source's local time; a clip never spans sources. */
export type Clip = { id: string; sourceId: string; start: number; end: number }
export type Span = { start: number; end: number }

export const MIN_CLIP_LENGTH = 0.2
const EPSILON = 1e-6

export function clamp(t: number, min: number, max: number): number {
  if (!Number.isFinite(t)) return min
  return Math.min(Math.max(t, min), max)
}

export function clampToDuration(t: number, duration: number): number {
  return clamp(t, 0, Math.max(0, duration))
}

export function clipDuration(clip: Span): number {
  return clip.end - clip.start
}

export function isValidSpan(start: number, end: number): boolean {
  return end - start >= MIN_CLIP_LENGTH - EPSILON
}

/**
 * Clips in source order, then by start time. `sourceOrder` lists source ids in timeline order;
 * clips of sources missing from it sort first.
 */
export function sortClips(clips: readonly Clip[], sourceOrder: readonly string[] = []): Clip[] {
  const rank = new Map(sourceOrder.map((id, i) => [id, i]))
  const rankOf = (clip: Clip) => rank.get(clip.sourceId) ?? -1
  return [...clips].sort((a, b) => rankOf(a) - rankOf(b) || a.start - b.start || a.end - b.end)
}

export function insertClip(
  clips: readonly Clip[],
  clip: Clip,
  sourceOrder: readonly string[] = [],
): Clip[] {
  return sortClips([...clips, clip], sourceOrder)
}

export function replaceClip(
  clips: readonly Clip[],
  clip: Clip,
  sourceOrder: readonly string[] = [],
): Clip[] {
  return sortClips(
    clips.map((c) => (c.id === clip.id ? clip : c)),
    sourceOrder,
  )
}

export function removeClip(clips: readonly Clip[], id: string): Clip[] {
  return clips.filter((c) => c.id !== id)
}

export function groupBySource(clips: readonly Clip[]): Map<string, Clip[]> {
  const groups = new Map<string, Clip[]>()
  for (const clip of clips) {
    const group = groups.get(clip.sourceId)
    if (group) group.push(clip)
    else groups.set(clip.sourceId, [clip])
  }
  return groups
}

/** Ids of every clip that overlaps at least one other clip of the same source. */
export function findOverlappingIds(clips: readonly Clip[]): Set<string> {
  const ids = new Set<string>()
  for (const group of groupBySource(clips).values()) {
    const sorted = sortClips(group)
    for (const [i, clip] of sorted.entries()) {
      for (const later of sorted.slice(i + 1)) {
        if (later.start >= clip.end) break
        ids.add(clip.id)
        ids.add(later.id)
      }
    }
  }
  return ids
}

/** Union of spans from one source; touching or overlapping spans become one segment. */
export function mergeOverlaps(spans: readonly Span[]): Span[] {
  const merged: Span[] = []
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ start: span.start, end: span.end })
    }
  }
  return merged
}

/** Length of the video the join step would produce (overlaps counted once per source). */
export function totalClippedDuration(clips: readonly Clip[]): number {
  let total = 0
  for (const group of groupBySource(clips).values()) {
    total += mergeOverlaps(group).reduce((sum, seg) => sum + clipDuration(seg), 0)
  }
  return total
}

export function canSetStart(clip: Span, start: number): boolean {
  return start >= -EPSILON && isValidSpan(start, clip.end)
}

export function canSetEnd(clip: Span, end: number, duration: number): boolean {
  return end <= duration + EPSILON && isValidSpan(clip.start, end)
}

/** Rounds away float noise such as 0.1 + 0.2. */
export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000
}

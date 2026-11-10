/**
 * The sequence is the session's sources played back to back in list order. Sequence time runs
 * from 0 to the sum of the durations; each source's local time runs from 0 to its duration.
 */
type Timed = { readonly duration: number }

export type Location = { index: number; localTime: number }

const lengthOf = (source: Timed) => (Number.isFinite(source.duration) ? source.duration : 0)

/** Sum of the durations before source `index`. */
export function offsetOf(sources: readonly Timed[], index: number): number {
  let offset = 0
  for (let i = 0; i < Math.min(index, sources.length); i++) offset += lengthOf(sources[i])
  return offset
}

export function totalDuration(sources: readonly Timed[]): number {
  return offsetOf(sources, sources.length)
}

/**
 * The source playing at sequence time `t` and the local time inside it. A time on a boundary
 * belongs to the start of the later source; times past the end land at the end of the last
 * source. With no sources the index is -1.
 */
export function locate(sources: readonly Timed[], t: number): Location {
  if (sources.length === 0) return { index: -1, localTime: 0 }
  const target = Number.isFinite(t) ? Math.max(t, 0) : 0
  let offset = 0
  for (let i = 0; i < sources.length; i++) {
    const length = lengthOf(sources[i])
    if (target < offset + length) return { index: i, localTime: target - offset }
    offset += length
  }
  const last = sources.length - 1
  return { index: last, localTime: lengthOf(sources[last]) }
}

export function toSequence(sources: readonly Timed[], index: number, localTime: number): number {
  return offsetOf(sources, index) + localTime
}

/** The list with the item at `from` moved so it ends up at index `to`. */
export function moveSource<T>(sources: readonly T[], from: number, to: number): T[] {
  const count = sources.length
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) return [...sources]
  const next = [...sources]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Where a dragged item lands when dropped into `slot` (0 = before the first item, `count` =
 * after the last). Dropping into the slot on either side of the item itself leaves it in place.
 */
export function dropIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot
}

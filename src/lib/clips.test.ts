import { describe, expect, it } from 'vitest'
import {
  canSetEnd,
  canSetStart,
  clampToDuration,
  findOverlappingIds,
  insertClip,
  manualClipSpan,
  mergeOverlaps,
  removeClip,
  replaceClip,
  roundTime,
  sortClips,
  totalClippedDuration,
  type Clip,
} from './clips'

const clip = (id: string, start: number, end: number): Clip => ({ id, start, end })

describe('insertion and sorting', () => {
  it('sorts by start then end', () => {
    const sorted = sortClips([clip('a', 5, 9), clip('b', 1, 4), clip('c', 5, 7)])
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('inserts a clip at its sorted position without mutating the input', () => {
    const clips = [clip('a', 1, 2), clip('b', 10, 12)]
    const next = insertClip(clips, clip('c', 5, 6))
    expect(next.map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(clips).toHaveLength(2)
  })

  it('re-sorts after an edit moves a clip', () => {
    const clips = [clip('a', 1, 2), clip('b', 10, 12)]
    expect(replaceClip(clips, clip('a', 20, 21)).map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('removes by id', () => {
    expect(removeClip([clip('a', 1, 2), clip('b', 3, 4)], 'a')).toEqual([clip('b', 3, 4)])
  })
})

describe('overlaps', () => {
  it('flags every clip that overlaps another', () => {
    const ids = findOverlappingIds([
      clip('a', 0, 5),
      clip('b', 4, 6),
      clip('c', 10, 12),
      clip('d', 1, 2),
    ])
    expect([...ids].sort()).toEqual(['a', 'b', 'd'])
  })

  it('does not flag clips that only touch', () => {
    expect(findOverlappingIds([clip('a', 0, 5), clip('b', 5, 6)]).size).toBe(0)
  })

  it('merges overlapping and touching clips into one segment', () => {
    expect(
      mergeOverlaps([clip('c', 20, 22), clip('a', 0, 5), clip('b', 4, 8), clip('d', 8, 9)]),
    ).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 22 },
    ])
  })

  it('keeps a contained clip inside the outer segment', () => {
    expect(mergeOverlaps([clip('a', 0, 10), clip('b', 2, 3)])).toEqual([{ start: 0, end: 10 }])
  })

  it('totals the clipped duration counting overlaps once', () => {
    expect(totalClippedDuration([clip('a', 0, 5), clip('b', 4, 8), clip('c', 10, 12)])).toBe(10)
    expect(totalClippedDuration([])).toBe(0)
  })
})

describe('clampToDuration', () => {
  it('clamps to [0, duration]', () => {
    expect(clampToDuration(-1, 10)).toBe(0)
    expect(clampToDuration(11, 10)).toBe(10)
    expect(clampToDuration(4, 10)).toBe(4)
    expect(clampToDuration(Number.NaN, 10)).toBe(0)
  })
})

describe('manualClipSpan', () => {
  it('makes a 2 s clip from the playhead', () => {
    expect(manualClipSpan(10, 60)).toEqual({ start: 10, end: 12 })
  })

  it('shifts back when the playhead is near the end', () => {
    expect(manualClipSpan(59, 60)).toEqual({ start: 58, end: 60 })
  })

  it('shrinks to the video when it is shorter than 2 s', () => {
    expect(manualClipSpan(0.5, 1)).toEqual({ start: 0, end: 1 })
  })
})

describe('nudge validation', () => {
  const c = clip('a', 1, 3)

  it('keeps start at or above 0', () => {
    expect(canSetStart(c, 0)).toBe(true)
    expect(canSetStart(c, -0.1)).toBe(false)
  })

  it('keeps end at or below duration', () => {
    expect(canSetEnd(c, 10, 10)).toBe(true)
    expect(canSetEnd(c, 10.1, 10)).toBe(false)
  })

  it('requires at least 0.2 s between start and end', () => {
    expect(canSetStart(c, 2.8)).toBe(true)
    expect(canSetStart(c, 2.9)).toBe(false)
    expect(canSetEnd(c, 1.2, 10)).toBe(true)
    expect(canSetEnd(c, 1.1, 10)).toBe(false)
  })

  it('tolerates float noise from repeated 0.1 s nudges', () => {
    const start = 0.1 + 0.2
    expect(canSetEnd(clip('a', start, 1), roundTime(start + 0.2), 10)).toBe(true)
    expect(roundTime(0.1 + 0.2)).toBe(0.3)
  })
})

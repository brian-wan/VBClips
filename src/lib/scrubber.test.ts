import { describe, expect, it } from 'vitest'
import type { Clip } from './clips'
import { edgeTime, hitTest, percentOf, timeAtX, trimClip, xOfTime } from './scrubber'

const clip = (id: string, start: number, end: number, sourceId = 's'): Clip => ({
  id,
  sourceId,
  start,
  end,
})

describe('position conversion', () => {
  it('maps x to time and clamps outside the track', () => {
    expect(timeAtX(50, 100, 30)).toBe(15)
    expect(timeAtX(-10, 100, 30)).toBe(0)
    expect(timeAtX(140, 100, 30)).toBe(30)
  })

  it('returns 0 for an empty track or unknown duration', () => {
    expect(timeAtX(50, 0, 30)).toBe(0)
    expect(timeAtX(50, 100, 0)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
  })

  it('maps time to x and percent', () => {
    expect(xOfTime(15, 200, 30)).toBe(100)
    expect(percentOf(7.5, 30)).toBe(25)
    expect(percentOf(40, 30)).toBe(100)
  })
})

describe('hitTest', () => {
  // 1000 px track, 100 s video: 10 px per second.
  const base = { width: 1000, duration: 100, playhead: 50, selectedId: null }
  const clips = [clip('a', 10, 20), clip('b', 15, 30), clip('c', 70, 80)]

  it('grabs the selected clip handles within 8 px of an edge', () => {
    const input = { ...base, clips, selectedId: 'c' }
    expect(hitTest({ ...input, x: 695 })).toEqual({ kind: 'handle', edge: 'start' })
    expect(hitTest({ ...input, x: 807 })).toEqual({ kind: 'handle', edge: 'end' })
    expect(hitTest({ ...input, x: 750 })).toEqual({ kind: 'clip', id: 'c' })
    expect(hitTest({ ...input, x: 690 })).toEqual({ kind: 'track' })
  })

  it('picks the nearer handle on a clip shorter than two hit widths', () => {
    const input = { ...base, clips: [clip('s', 40, 40.5)], selectedId: 's' }
    expect(hitTest({ ...input, x: 401 })).toEqual({ kind: 'handle', edge: 'start' })
    expect(hitTest({ ...input, x: 404 })).toEqual({ kind: 'handle', edge: 'end' })
  })

  it('ignores handles when nothing is selected', () => {
    expect(hitTest({ ...base, clips, x: 700 })).toEqual({ kind: 'clip', id: 'c' })
  })

  it('grabs the playhead before a clip segment under it', () => {
    expect(hitTest({ ...base, clips, playhead: 75, x: 752 })).toEqual({ kind: 'playhead' })
    expect(hitTest({ ...base, clips, playhead: 75, x: 760 })).toEqual({ kind: 'clip', id: 'c' })
  })

  it('ignores the playhead when it is in another block', () => {
    expect(hitTest({ ...base, clips, playhead: null, x: 752 })).toEqual({ kind: 'clip', id: 'c' })
    expect(hitTest({ ...base, clips: [], playhead: null, x: 0 })).toEqual({ kind: 'track' })
  })

  it('prefers handles over the playhead', () => {
    const input = { ...base, clips, selectedId: 'c', playhead: 70 }
    expect(hitTest({ ...input, x: 700 })).toEqual({ kind: 'handle', edge: 'start' })
  })

  it('picks the later clip where clips overlap', () => {
    expect(hitTest({ ...base, clips, x: 170 })).toEqual({ kind: 'clip', id: 'b' })
    expect(hitTest({ ...base, clips, x: 120 })).toEqual({ kind: 'clip', id: 'a' })
  })

  it('falls back to the track', () => {
    expect(hitTest({ ...base, clips, x: 400 })).toEqual({ kind: 'track' })
    expect(hitTest({ ...base, clips, width: 0, x: 400 })).toEqual({ kind: 'track' })
  })
})

describe('trimClip', () => {
  const c = clip('a', 10, 20)

  it('moves the start edge', () => {
    expect(trimClip(c, 'start', 12.34, 100)).toEqual(clip('a', 12.34, 20))
    expect(trimClip(c, 'start', 5, 100)).toEqual(clip('a', 5, 20))
  })

  it('moves the end edge', () => {
    expect(trimClip(c, 'end', 25.5, 100)).toEqual(clip('a', 10, 25.5))
  })

  it('stops the start at 0 and at the minimum length', () => {
    expect(trimClip(c, 'start', -3, 100).start).toBe(0)
    expect(trimClip(c, 'start', 19.95, 100).start).toBeCloseTo(19.8)
    expect(trimClip(c, 'start', 40, 100).start).toBeCloseTo(19.8)
  })

  it('stops the end at the duration and at the minimum length', () => {
    expect(trimClip(c, 'end', 130, 100).end).toBe(100)
    expect(trimClip(c, 'end', 10.05, 100).end).toBeCloseTo(10.2)
    expect(trimClip(c, 'end', 2, 100).end).toBeCloseTo(10.2)
  })

  it('keeps the result valid when the bound is not on the millisecond grid', () => {
    const odd = clip('o', 1, 7.33367)
    const trimmed = trimClip(odd, 'start', 9, 100)
    expect(trimmed.end - trimmed.start).toBeGreaterThanOrEqual(0.2 - 1e-6)
  })

  it('rounds to the millisecond', () => {
    expect(trimClip(c, 'end', 15.123456, 100).end).toBe(15.123)
  })

  it('leaves the clip alone when no valid end exists', () => {
    const late = clip('l', 99.9, 100)
    expect(trimClip(late, 'end', 50, 99.95)).toBe(late)
  })

  it('reads the dragged edge time', () => {
    expect(edgeTime(c, 'start')).toBe(10)
    expect(edgeTime(c, 'end')).toBe(20)
  })
})

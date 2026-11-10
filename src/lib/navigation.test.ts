import { describe, expect, it } from 'vitest'
import { currentClipIndex, nextClipIndex, prevClipIndex } from './navigation'

type Clip = { id: string; start: number; end: number }

const clips: Clip[] = [
  { id: 'a', start: 10, end: 15 },
  { id: 'b', start: 20, end: 25 },
  { id: 'c', start: 30, end: 35 },
]

describe('currentClipIndex', () => {
  it('uses the selected clip when the playhead is inside it', () => {
    const overlapping: Clip[] = [
      { id: 'a', start: 10, end: 20 },
      { id: 'b', start: 12, end: 14 },
    ]
    expect(currentClipIndex(overlapping, 13, 'a')).toBe(0)
  })

  it('falls back to the last clip starting before the playhead', () => {
    expect(currentClipIndex(clips, 27, 'a')).toBe(1)
    expect(currentClipIndex(clips, 5, null)).toBe(-1)
  })
})

describe('nextClipIndex', () => {
  it('returns -1 with no clips', () => {
    expect(nextClipIndex([], 0, null)).toBe(-1)
  })

  it('goes to the first clip from before it', () => {
    expect(nextClipIndex(clips, 0, null)).toBe(0)
  })

  it('goes to the following clip', () => {
    expect(nextClipIndex(clips, 10, 'a')).toBe(1)
    expect(nextClipIndex(clips, 17, null)).toBe(1)
  })

  it('wraps to the first clip from after the last', () => {
    expect(nextClipIndex(clips, 40, null)).toBe(0)
    expect(nextClipIndex(clips, 30, 'c')).toBe(0)
  })

  it('steps through clips sharing a start time by selection', () => {
    const same: Clip[] = [
      { id: 'a', start: 10, end: 12 },
      { id: 'b', start: 10, end: 14 },
    ]
    expect(nextClipIndex(same, 10, 'a')).toBe(1)
  })
})

describe('prevClipIndex', () => {
  it('returns -1 with no clips', () => {
    expect(prevClipIndex([], 0, null)).toBe(-1)
  })

  it('restarts the current clip when more than 1 s in', () => {
    expect(prevClipIndex(clips, 22, 'b')).toBe(1)
  })

  it('goes to the previous clip within the first second', () => {
    expect(prevClipIndex(clips, 20.5, 'b')).toBe(0)
    expect(prevClipIndex(clips, 20, 'b')).toBe(0)
  })

  it('restarts the most recent clip from a gap after it', () => {
    expect(prevClipIndex(clips, 27, null)).toBe(1)
  })

  it('stays on the first clip instead of wrapping backwards', () => {
    expect(prevClipIndex(clips, 10.2, 'a')).toBe(0)
    expect(prevClipIndex(clips, 2, null)).toBe(0)
  })
})

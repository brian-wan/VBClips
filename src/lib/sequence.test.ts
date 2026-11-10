import { describe, expect, it } from 'vitest'
import { dropIndex, locate, moveSource, offsetOf, toSequence, totalDuration } from './sequence'

const sources = [{ duration: 10 }, { duration: 30 }, { duration: 5 }]

describe('offsets', () => {
  it('sums the durations before each source', () => {
    expect(offsetOf(sources, 0)).toBe(0)
    expect(offsetOf(sources, 1)).toBe(10)
    expect(offsetOf(sources, 2)).toBe(40)
    expect(offsetOf(sources, 9)).toBe(45)
  })

  it('totals the sequence', () => {
    expect(totalDuration(sources)).toBe(45)
    expect(totalDuration([])).toBe(0)
  })

  it('treats an unknown duration as zero', () => {
    expect(totalDuration([{ duration: NaN }, { duration: 4 }])).toBe(4)
  })
})

describe('locate', () => {
  it('finds the source and local time', () => {
    expect(locate(sources, 0)).toEqual({ index: 0, localTime: 0 })
    expect(locate(sources, 9.5)).toEqual({ index: 0, localTime: 9.5 })
    expect(locate(sources, 25)).toEqual({ index: 1, localTime: 15 })
    expect(locate(sources, 42)).toEqual({ index: 2, localTime: 2 })
  })

  it('puts a boundary at the start of the later source', () => {
    expect(locate(sources, 10)).toEqual({ index: 1, localTime: 0 })
    expect(locate(sources, 40)).toEqual({ index: 2, localTime: 0 })
  })

  it('clamps to the ends of the sequence', () => {
    expect(locate(sources, -3)).toEqual({ index: 0, localTime: 0 })
    expect(locate(sources, 45)).toEqual({ index: 2, localTime: 5 })
    expect(locate(sources, 99)).toEqual({ index: 2, localTime: 5 })
    expect(locate(sources, NaN)).toEqual({ index: 0, localTime: 0 })
  })

  it('returns -1 without sources', () => {
    expect(locate([], 5)).toEqual({ index: -1, localTime: 0 })
  })

  it('round-trips with toSequence', () => {
    for (const t of [0, 3, 10, 27.5, 44]) {
      const { index, localTime } = locate(sources, t)
      expect(toSequence(sources, index, localTime)).toBe(t)
    }
  })
})

describe('moveSource', () => {
  const list = ['a', 'b', 'c', 'd']

  it('moves an item forward and back', () => {
    expect(moveSource(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveSource(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('returns an unchanged copy for no-op or out-of-range moves', () => {
    expect(moveSource(list, 1, 1)).toEqual(list)
    expect(moveSource(list, -1, 2)).toEqual(list)
    expect(moveSource(list, 1, 4)).toEqual(list)
    expect(moveSource(list, 0, 2)).not.toBe(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('maps a drop slot to the final index', () => {
    expect(dropIndex(1, 0)).toBe(0)
    expect(dropIndex(1, 1)).toBe(1)
    expect(dropIndex(1, 2)).toBe(1)
    expect(dropIndex(1, 4)).toBe(3)
    expect(moveSource(list, 0, dropIndex(0, 4))).toEqual(['b', 'c', 'd', 'a'])
  })
})

import { describe, expect, it } from 'vitest'
import { roundThumbTime, shouldRelayout, thumbKey, tileCount, tileTimes } from './filmstrip'

describe('filmstrip tiles', () => {
  it('covers the width with whole tiles', () => {
    expect(tileCount(640, 64)).toBe(10)
    expect(tileCount(641, 64)).toBe(11)
    expect(tileCount(0, 64)).toBe(0)
  })

  it('takes evenly spaced times at the middle of each tile', () => {
    expect(tileTimes(0, 40, 4)).toEqual([5, 15, 25, 35])
    expect(tileTimes(8, 14, 2)).toEqual([9.5, 12.5])
    expect(tileTimes(5, 5, 3)).toEqual([])
  })

  it('keys frames by source and rounded time', () => {
    expect(roundThumbTime(12.345)).toBe(12.3)
    expect(thumbKey('a|1|2', 3.04)).toBe('a|1|2@3.0')
    expect(thumbKey('a|1|2', 3)).toBe(thumbKey('a|1|2', 2.98))
  })

  it('relays out only after the width changes by more than a tile', () => {
    expect(shouldRelayout(1000, 1050, 64)).toBe(false)
    expect(shouldRelayout(1000, 1065, 64)).toBe(true)
    expect(shouldRelayout(1000, 930, 64)).toBe(true)
  })
})

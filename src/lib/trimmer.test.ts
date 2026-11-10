import { describe, expect, it } from 'vitest'
import { handleAt, shouldRecenter, timeAtX, trimWindow, xOfTime } from './trimmer'

describe('trimWindow', () => {
  it('pads a short clip by 2 s on each side', () => {
    expect(trimWindow({ start: 10, end: 12 }, 100)).toEqual({ start: 8, end: 14 })
  })

  it('pads a long clip by half its length', () => {
    expect(trimWindow({ start: 20, end: 30 }, 100)).toEqual({ start: 15, end: 35 })
  })

  it('clamps to the source', () => {
    expect(trimWindow({ start: 0.5, end: 2 }, 3)).toEqual({ start: 0, end: 3 })
  })
})

describe('timeAtX and xOfTime', () => {
  const window = { start: 8, end: 14 }

  it('maps the strip width onto the window', () => {
    expect(timeAtX(0, 300, window)).toBe(8)
    expect(timeAtX(150, 300, window)).toBe(11)
    expect(timeAtX(300, 300, window)).toBe(14)
    expect(xOfTime(11, 300, window)).toBe(150)
  })

  it('moves about 20 ms per pixel for a 6 s window over 300px', () => {
    expect(timeAtX(101, 300, window) - timeAtX(100, 300, window)).toBeCloseTo(0.02)
  })

  it('clamps outside the strip', () => {
    expect(timeAtX(-40, 300, window)).toBe(8)
    expect(timeAtX(400, 300, window)).toBe(14)
    expect(xOfTime(2, 300, window)).toBe(0)
    expect(timeAtX(10, 0, window)).toBe(8)
  })
})

describe('shouldRecenter', () => {
  const window = { start: 0, end: 10 }

  it('recenters when an edge is within 10% of the window edge', () => {
    expect(shouldRecenter({ start: 0.5, end: 5 }, window)).toBe(true)
    expect(shouldRecenter({ start: 3, end: 9.5 }, window)).toBe(true)
  })

  it('keeps the window while both edges have room', () => {
    expect(shouldRecenter({ start: 2, end: 8 }, window)).toBe(false)
  })
})

describe('handleAt', () => {
  const window = { start: 0, end: 10 }
  const clip = { start: 4, end: 6 }

  it('finds the handle just outside each clip edge', () => {
    expect(handleAt(116, 300, window, clip)).toBe('start')
    expect(handleAt(184, 300, window, clip)).toBe('end')
  })

  it('returns null away from the handles', () => {
    expect(handleAt(150, 300, window, clip)).toBeNull()
    expect(handleAt(20, 300, window, clip)).toBeNull()
  })
})

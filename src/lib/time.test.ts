import { describe, expect, it } from 'vitest'
import { formatTime, formatTimePrecise } from './time'

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [599.99, '9:59'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725.4, '1:02:05'],
    [-3, '0:00'],
    [Number.NaN, '0:00'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected)
  })
})

describe('formatTimePrecise', () => {
  it.each([
    [0, '0:00.0'],
    [4.25, '0:04.3'],
    [65.04, '1:05.0'],
    [59.96, '1:00.0'],
    [3725.45, '1:02:05.5'],
    [Number.POSITIVE_INFINITY, '0:00.0'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTimePrecise(input)).toBe(expected)
  })
})

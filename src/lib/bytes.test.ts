import { describe, expect, it } from 'vitest'
import { formatBytes } from './bytes'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1500, '1.5 KB'],
    [250_000_000, '250 MB'],
    [1_234_000_000, '1.2 GB'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected)
  })
})

import { describe, expect, it } from 'vitest'
import { nextSpeed } from './speed'

describe('nextSpeed', () => {
  it('cycles 1× → 1.5× → 2× → 1×', () => {
    expect(nextSpeed(1)).toBe(1.5)
    expect(nextSpeed(1.5)).toBe(2)
    expect(nextSpeed(2)).toBe(1)
  })

  it('restarts at 1× from an unknown speed', () => {
    expect(nextSpeed(3)).toBe(1)
  })
})

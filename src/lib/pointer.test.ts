import { afterEach, describe, expect, it, vi } from 'vitest'
import { pointerTolerance, toleranceFor } from './pointer'

describe('pointer tolerance', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the mouse values for a fine pointer', () => {
    expect(toleranceFor(false)).toEqual({
      handle: 8,
      playhead: 6,
      trimHandleWidth: 8,
      trimHandle: 12,
    })
  })

  it('grows the handles to a 44px touch target and draws them 12px wide', () => {
    expect(toleranceFor(true)).toEqual({
      handle: 22,
      playhead: 12,
      trimHandleWidth: 12,
      trimHandle: 22,
    })
  })

  it('follows the (pointer: coarse) media query', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' }))
    vi.stubGlobal('matchMedia', matchMedia)
    expect(pointerTolerance()).toEqual(toleranceFor(true))
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('falls back to the mouse values without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(pointerTolerance()).toEqual(toleranceFor(false))
  })
})

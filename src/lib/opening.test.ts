import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SLOW_OPENING_HINT,
  SLOW_OPENING_MS,
  advanceOpening,
  openingLabel,
  startOpening,
  watchSlowOpening,
} from './opening'

describe('openingLabel', () => {
  it('names a single file', () => {
    expect(openingLabel(['saturday-game.mp4'], 0)).toBe('Opening saturday-game.mp4…')
  })

  it('counts several files, naming the one being opened', () => {
    const names = ['a.mp4', 'b.mp4', 'c.mp4']
    expect(openingLabel(names, 0)).toBe('Opening 1 of 3…')
    expect(openingLabel(names, 1)).toBe('Opening 2 of 3…')
    expect(openingLabel(names, 3)).toBe('Opening 3 of 3…')
  })
})

describe('startOpening and advanceOpening', () => {
  it('counts files across overlapping batches and ends when all are done', () => {
    let opening = startOpening(null, ['a.mp4'])
    opening = startOpening(opening, ['b.mp4', 'c.mp4'])
    expect(opening).toEqual({ names: ['a.mp4', 'b.mp4', 'c.mp4'], done: 0 })
    expect(advanceOpening(advanceOpening(opening))).toEqual({
      names: ['a.mp4', 'b.mp4', 'c.mp4'],
      done: 2,
    })
    expect(advanceOpening(advanceOpening(advanceOpening(opening)))).toBeNull()
    expect(advanceOpening(null)).toBeNull()
  })
})

describe('watchSlowOpening', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the second line once the opening has lasted 3 s', () => {
    const onSlow = vi.fn()
    watchSlowOpening(onSlow)
    vi.advanceTimersByTime(SLOW_OPENING_MS - 1)
    expect(onSlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(onSlow).toHaveBeenCalledTimes(1)
  })

  it('never shows it for an opening that ends first', () => {
    const onSlow = vi.fn()
    const cancel = watchSlowOpening(onSlow)
    vi.advanceTimersByTime(2999)
    cancel()
    vi.advanceTimersByTime(60_000)
    expect(onSlow).not.toHaveBeenCalled()
  })

  it('explains where slow files usually live', () => {
    expect(SLOW_OPENING_HINT).toBe(
      'Still reading the file. Videos stored in iCloud or on an external drive take longer the first time.',
    )
  })
})

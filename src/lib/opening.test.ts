import { describe, expect, it } from 'vitest'
import { advanceOpening, openingLabel, startOpening } from './opening'

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

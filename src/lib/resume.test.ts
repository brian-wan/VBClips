import { describe, expect, it } from 'vitest'
import { matchSavedSources } from './resume'
import { sourceMeta } from './session'

const game = { name: 'game.mp4', size: 10, lastModified: 1 }
const court = { name: 'court2.mov', size: 20, lastModified: 2 }
const other = { name: 'other.mp4', size: 30, lastModified: 3 }
const one = { sources: [sourceMeta(game, 60)] }
const two = { sources: [sourceMeta(game, 60), sourceMeta(court, 30)] }
const none = new Map<string, typeof game>()

describe('matchSavedSources', () => {
  it('reports a mismatch for a one-video save when the picked file is not it', () => {
    expect(matchSavedSources(one, none, [other])).toEqual({ kind: 'mismatch', file: other })
  })

  it('opens at once when every source is found', () => {
    const match = matchSavedSources(one, none, [game])
    expect(match).toMatchObject({ kind: 'matched', complete: true, missing: [] })
  })

  it('never reports a mismatch for a save with several videos', () => {
    const match = matchSavedSources(two, none, [other])
    expect(match.kind).toBe('matched')
    // Nothing matched, so "Open without them" has nothing to open.
    expect(match.kind === 'matched' && match.found.size).toBe(0)
  })

  it('keeps earlier finds and lists what is still needed', () => {
    const first = matchSavedSources(two, none, [court, other])
    if (first.kind !== 'matched') throw new Error('expected a match')
    expect([...first.found.values()]).toEqual([court])
    expect(first.missing.map((s) => s.name)).toEqual(['game.mp4'])
    expect(first.complete).toBe(false)

    const second = matchSavedSources(two, first.found, [game])
    expect(second).toMatchObject({ kind: 'matched', complete: true })
    expect(second.kind === 'matched' && second.found.size).toBe(2)
  })

  it('treats an empty pick as nothing matched rather than a mismatch', () => {
    expect(matchSavedSources(one, none, [])).toMatchObject({ kind: 'matched', complete: false })
  })
})

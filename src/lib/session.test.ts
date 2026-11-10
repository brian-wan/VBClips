import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  initialSession,
  markEndProblem,
  sessionReducer,
  sourceMeta,
  type SessionAction,
  type SessionState,
} from './session'

const a = sourceMeta({ name: 'a.mp4', size: 1, lastModified: 1 }, 100)
const b = sourceMeta({ name: 'b.mov', size: 2, lastModified: 2 }, 50)
const c = sourceMeta({ name: 'c.mp4', size: 3, lastModified: 3 }, 20)
const loaded = sessionReducer(initialSession, { type: 'load', sources: [a], clips: [] })
const run = (state: SessionState, ...actions: SessionAction[]) =>
  actions.reduce(sessionReducer, state)
const clip = (id: string, start: number, end: number, sourceId = a.id) => ({
  id,
  sourceId,
  start,
  end,
})
/** Marks a clip the way the editor does: a start press, then an end press. */
const mark = (id: string, start: number, end: number, sourceId = a.id): SessionAction[] => [
  { type: 'markStart', sourceId, time: start },
  { type: 'markEnd', sourceId, time: end, id },
]

describe('sources', () => {
  it('ids a source by its fingerprint', () => {
    expect(a).toEqual({ id: 'a.mp4|1|1', name: 'a.mp4', size: 1, lastModified: 1, duration: 100 })
  })

  it('loads sources in order and drops clips of unknown sources', () => {
    const state = sessionReducer(initialSession, {
      type: 'load',
      sources: [b, a],
      clips: [clip('1', 5, 6), clip('2', 1, 2, b.id), clip('3', 1, 2, 'gone')],
    })
    expect(state.sources.map((s) => s.id)).toEqual([b.id, a.id])
    expect(state.clips.map((c) => c.id)).toEqual(['2', '1'])
    expect(state.past).toHaveLength(0)
  })

  it('appends a source once', () => {
    const added = run(loaded, { type: 'addSource', source: b })
    expect(added.sources).toEqual([a, b])
    expect(run(added, { type: 'addSource', source: b })).toBe(added)
  })

  it('removes a source with its clips, selection and open marker', () => {
    const state = run(
      loaded,
      { type: 'addSource', source: b },
      ...mark('x', 1, 3),
      ...mark('y', 1, 3, b.id),
      { type: 'markStart', sourceId: b.id, time: 10 },
    )
    expect(state.selectedId).toBe('y')
    const removed = run(state, { type: 'removeSource', id: b.id })
    expect(removed.sources).toEqual([a])
    expect(removed.clips.map((c) => c.id)).toEqual(['x'])
    expect(removed.selectedId).toBeNull()
    expect(removed.openStart).toBeNull()
    expect(run(removed, { type: 'removeSource', id: 'missing' })).toBe(removed)
  })

  it('reorders sources and re-sorts clips into source order', () => {
    const state = run(
      loaded,
      { type: 'addSource', source: b },
      { type: 'addSource', source: c },
      ...mark('in-a', 1, 3),
      ...mark('in-c', 1, 3, c.id),
    )
    expect(state.clips.map((x) => x.id)).toEqual(['in-a', 'in-c'])
    const moved = run(state, { type: 'moveSource', from: 2, to: 0 })
    expect(moved.sources.map((s) => s.name)).toEqual(['c.mp4', 'a.mp4', 'b.mov'])
    expect(moved.clips.map((x) => x.id)).toEqual(['in-c', 'in-a'])
    expect(run(moved, { type: 'moveSource', from: 1, to: 1 })).toBe(moved)
    expect(run(moved, { type: 'moveSource', from: 0, to: 3 })).toBe(moved)
  })
})

describe('marking', () => {
  it('opens a marker and saves a selected clip on the second press', () => {
    const marking = run(loaded, { type: 'markStart', sourceId: a.id, time: 5 })
    expect(marking.openStart).toEqual({ sourceId: a.id, time: 5 })
    const saved = run(marking, { type: 'markEnd', sourceId: a.id, time: 9, id: 'x' })
    expect(saved.openStart).toBeNull()
    expect(saved.clips).toEqual([clip('x', 5, 9)])
    expect(saved.selectedId).toBe('x')
  })

  it('stays in the marking state when the end is under 0.2 s after the start', () => {
    const marking = run(loaded, { type: 'markStart', sourceId: a.id, time: 5 })
    const open = marking.openStart
    expect(markEndProblem(open, a.id, 5.1)).toBe('tooShort')
    expect(markEndProblem(open, a.id, 3)).toBe('tooShort')
    expect(markEndProblem(open, a.id, 5.2)).toBeNull()
    expect(markEndProblem(null, a.id, 9)).toBe('noMarker')
    expect(run(marking, { type: 'markEnd', sourceId: a.id, time: 3, id: 'x' })).toBe(marking)
  })

  it('keeps the marker open when the end is in another source', () => {
    const marking = run(
      loaded,
      { type: 'addSource', source: b },
      { type: 'markStart', sourceId: a.id, time: 5 },
    )
    expect(markEndProblem(marking.openStart, b.id, 9)).toBe('otherSource')
    expect(run(marking, { type: 'markEnd', sourceId: b.id, time: 9, id: 'x' })).toBe(marking)
  })

  it('cancels the open marker without touching clips or history', () => {
    const after = run(
      loaded,
      { type: 'markStart', sourceId: a.id, time: 5 },
      { type: 'cancelMark' },
    )
    expect(after.openStart).toBeNull()
    expect(after.past).toHaveLength(0)
  })

  it('keeps clips sorted as they are marked', () => {
    const after = run(
      loaded,
      { type: 'markStart', sourceId: a.id, time: 50 },
      { type: 'markEnd', sourceId: a.id, time: 55, id: 'late' },
      { type: 'markStart', sourceId: a.id, time: 10 },
      { type: 'markEnd', sourceId: a.id, time: 15, id: 'early' },
    )
    expect(after.clips.map((x) => x.id)).toEqual(['early', 'late'])
  })
})

describe('clip changes', () => {
  const withClip = run(loaded, ...mark('a', 1, 3))

  it('adds and selects a marked clip', () => {
    expect(withClip.clips).toHaveLength(1)
    expect(withClip.selectedId).toBe('a')
  })

  it('edits a clip and rejects invalid spans', () => {
    const edited = run(withClip, { type: 'updateClip', clip: clip('a', 1, 4) })
    expect(edited.clips[0]?.end).toBe(4)
    const invalid = run(withClip, { type: 'updateClip', clip: clip('a', 1, 1.1) })
    expect(invalid).toBe(withClip)
  })

  it('never moves a clip to another source through an edit', () => {
    const edited = run(withClip, { type: 'updateClip', clip: clip('a', 1, 4, 'other') })
    expect(edited.clips[0]?.sourceId).toBe(a.id)
  })

  it('ignores no-op edits so they do not fill history', () => {
    expect(run(withClip, { type: 'updateClip', clip: clip('a', 1, 3) })).toBe(withClip)
  })

  it('deletes a clip and clears its selection', () => {
    const deleted = run(withClip, { type: 'deleteClip', id: 'a' })
    expect(deleted.clips).toHaveLength(0)
    expect(deleted.selectedId).toBeNull()
    expect(run(deleted, { type: 'deleteClip', id: 'missing' })).toBe(deleted)
  })
})

describe('undo and redo', () => {
  const added = run(loaded, ...mark('a', 1, 3))
  const edited = run(added, { type: 'updateClip', clip: clip('a', 1, 5) })
  const deleted = run(edited, { type: 'deleteClip', id: 'a' })

  it('reverts delete, edit and add in order', () => {
    const u1 = run(deleted, { type: 'undo' })
    expect(u1.clips).toEqual([clip('a', 1, 5)])
    const u2 = run(u1, { type: 'undo' })
    expect(u2.clips).toEqual([clip('a', 1, 3)])
    const u3 = run(u2, { type: 'undo' })
    expect(u3.clips).toEqual([])
    expect(run(u3, { type: 'undo' })).toBe(u3)
  })

  it('redoes what was undone and stops at the end', () => {
    const back = run(deleted, { type: 'undo' }, { type: 'undo' })
    const forward = run(back, { type: 'redo' }, { type: 'redo' })
    expect(forward.clips).toEqual([])
    expect(run(forward, { type: 'redo' })).toBe(forward)
  })

  it('clears redo after a new change', () => {
    const branched = run(deleted, { type: 'undo' }, ...mark('b', 8, 9))
    expect(branched.future).toHaveLength(0)
    expect(run(branched, { type: 'redo' })).toBe(branched)
  })

  it('does not record selection or marker changes', () => {
    const state = run(
      added,
      { type: 'select', id: null },
      { type: 'markStart', sourceId: a.id, time: 4 },
    )
    expect(state.past).toHaveLength(added.past.length)
  })

  it('drops the selection when undo removes the selected clip', () => {
    expect(run(added, { type: 'undo' }).selectedId).toBeNull()
  })

  it('reverts adding, removing and reordering sources', () => {
    const withB = run(added, { type: 'addSource', source: b })
    const withBClip = run(withB, ...mark('b1', 0, 2, b.id))
    const moved = run(withBClip, { type: 'moveSource', from: 1, to: 0 })
    const removed = run(moved, { type: 'removeSource', id: b.id })
    expect(removed.sources).toEqual([a])
    expect(removed.clips.map((x) => x.id)).toEqual(['a'])

    const u1 = run(removed, { type: 'undo' })
    expect(u1.sources).toEqual([b, a])
    expect(u1.clips.map((x) => x.id)).toEqual(['b1', 'a'])
    const u2 = run(u1, { type: 'undo' })
    expect(u2.sources).toEqual([a, b])
    expect(u2.clips.map((x) => x.id)).toEqual(['a', 'b1'])
    const u3 = run(u2, { type: 'undo' }, { type: 'undo' })
    expect(u3.sources).toEqual([a])

    const r = run(u3, { type: 'redo' }, { type: 'redo' }, { type: 'redo' }, { type: 'redo' })
    expect(r.sources).toEqual([a])
    expect(r.clips.map((x) => x.id)).toEqual(['a'])
  })

  it('drops an open marker when undo removes its source', () => {
    const state = run(
      loaded,
      { type: 'addSource', source: b },
      { type: 'markStart', sourceId: b.id, time: 3 },
      { type: 'undo' },
    )
    expect(state.openStart).toBeNull()
  })

  it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
    let state = loaded
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      state = run(state, ...mark(`c${i}`, i, i + 1))
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) state = run(state, { type: 'undo' })
    expect(state.clips).toHaveLength(10)
  })
})

describe('restoring what an undo toast refers to', () => {
  const marked = (state: SessionState, id: string, start: number, end: number, sourceId = a.id) =>
    run(state, ...mark(id, start, end, sourceId))
  const two = marked(marked(loaded, 'x', 1, 3), 'y', 10, 12)

  it('puts a deleted clip back as one undo step, leaving later changes alone', () => {
    const deleted = run(two, { type: 'deleteClip', id: 'x' })
    const later = run(deleted, { type: 'updateClip', clip: clip('y', 10, 14) })
    const restored = run(later, { type: 'restoreClip', clip: clip('x', 1, 3) })
    expect(restored.clips).toEqual([clip('x', 1, 3), clip('y', 10, 14)])
    expect(run(restored, { type: 'undo' }).clips).toEqual(later.clips)
  })

  it('does not restore a clip that is already there or whose source is gone', () => {
    expect(run(two, { type: 'restoreClip', clip: clip('x', 1, 3) })).toBe(two)
    expect(run(two, { type: 'restoreClip', clip: clip('z', 1, 3, b.id) })).toBe(two)
  })

  it('puts a removed source back at its place with its clips', () => {
    const three = marked(
      run(two, { type: 'addSource', source: b }, { type: 'addSource', source: c }),
      'b1',
      0,
      2,
      b.id,
    )
    const removed = run(three, { type: 'removeSource', id: b.id })
    const later = marked(removed, 'c1', 1, 4, c.id)
    const restored = run(later, {
      type: 'restoreSource',
      source: b,
      index: 1,
      clips: [clip('b1', 0, 2, b.id)],
    })
    expect(restored.sources).toEqual([a, b, c])
    expect(restored.clips.map((x) => x.id)).toEqual(['x', 'y', 'b1', 'c1'])
    expect(run(restored, { type: 'undo' })).toMatchObject({
      sources: later.sources,
      clips: later.clips,
    })
    expect(run(restored, { type: 'restoreSource', source: b, index: 0, clips: [] })).toBe(restored)
  })
})

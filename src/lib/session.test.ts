import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  canEndMark,
  initialSession,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from './session'

const video = { name: 'v.mp4', size: 1, lastModified: 1, duration: 100 }
const loaded = sessionReducer(initialSession, { type: 'load', video, clips: [] })
const run = (state: SessionState, ...actions: SessionAction[]) =>
  actions.reduce(sessionReducer, state)

describe('marking', () => {
  it('opens a marker and saves a selected clip on the second press', () => {
    const marking = run(loaded, { type: 'markStart', time: 5 })
    expect(marking.openStart).toBe(5)
    const saved = run(marking, { type: 'markEnd', time: 9, id: 'x' })
    expect(saved.openStart).toBeNull()
    expect(saved.clips).toEqual([{ id: 'x', start: 5, end: 9 }])
    expect(saved.selectedId).toBe('x')
  })

  it('stays in the marking state when the end is under 0.2 s after the start', () => {
    const marking = run(loaded, { type: 'markStart', time: 5 })
    expect(canEndMark(5, 5.1)).toBe(false)
    expect(canEndMark(5, 3)).toBe(false)
    expect(canEndMark(5, 5.2)).toBe(true)
    expect(canEndMark(null, 9)).toBe(false)
    const after = run(marking, { type: 'markEnd', time: 3, id: 'x' })
    expect(after).toBe(marking)
  })

  it('cancels the open marker without touching clips or history', () => {
    const after = run(loaded, { type: 'markStart', time: 5 }, { type: 'cancelMark' })
    expect(after.openStart).toBeNull()
    expect(after.past).toHaveLength(0)
  })

  it('keeps clips sorted as they are marked', () => {
    const after = run(
      loaded,
      { type: 'markStart', time: 50 },
      { type: 'markEnd', time: 55, id: 'late' },
      { type: 'markStart', time: 10 },
      { type: 'markEnd', time: 15, id: 'early' },
    )
    expect(after.clips.map((c) => c.id)).toEqual(['early', 'late'])
  })
})

describe('clip changes', () => {
  const withClip = run(loaded, { type: 'addClip', clip: { id: 'a', start: 1, end: 3 } })

  it('adds and selects a manual clip', () => {
    expect(withClip.clips).toHaveLength(1)
    expect(withClip.selectedId).toBe('a')
  })

  it('edits a clip and rejects invalid spans', () => {
    const edited = run(withClip, { type: 'updateClip', clip: { id: 'a', start: 1, end: 4 } })
    expect(edited.clips[0].end).toBe(4)
    const invalid = run(withClip, { type: 'updateClip', clip: { id: 'a', start: 1, end: 1.1 } })
    expect(invalid).toBe(withClip)
  })

  it('ignores no-op edits so they do not fill history', () => {
    expect(run(withClip, { type: 'updateClip', clip: { id: 'a', start: 1, end: 3 } })).toBe(
      withClip,
    )
  })

  it('deletes a clip and clears its selection', () => {
    const deleted = run(withClip, { type: 'deleteClip', id: 'a' })
    expect(deleted.clips).toHaveLength(0)
    expect(deleted.selectedId).toBeNull()
    expect(run(deleted, { type: 'deleteClip', id: 'missing' })).toBe(deleted)
  })

  it('loads saved clips sorted with empty history', () => {
    const state = sessionReducer(withClip, {
      type: 'load',
      video,
      clips: [
        { id: 'b', start: 9, end: 10 },
        { id: 'a', start: 1, end: 2 },
      ],
    })
    expect(state.clips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(state.past).toHaveLength(0)
  })

  it('updates the duration once metadata loads', () => {
    expect(run(loaded, { type: 'setDuration', duration: 42 }).video?.duration).toBe(42)
    expect(run(initialSession, { type: 'setDuration', duration: 42 })).toBe(initialSession)
  })
})

describe('undo and redo', () => {
  const added = run(loaded, { type: 'addClip', clip: { id: 'a', start: 1, end: 3 } })
  const edited = run(added, { type: 'updateClip', clip: { id: 'a', start: 1, end: 5 } })
  const deleted = run(edited, { type: 'deleteClip', id: 'a' })

  it('reverts delete, edit and add in order', () => {
    const u1 = run(deleted, { type: 'undo' })
    expect(u1.clips).toEqual([{ id: 'a', start: 1, end: 5 }])
    const u2 = run(u1, { type: 'undo' })
    expect(u2.clips).toEqual([{ id: 'a', start: 1, end: 3 }])
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
    const branched = run(
      deleted,
      { type: 'undo' },
      { type: 'addClip', clip: { id: 'b', start: 8, end: 9 } },
    )
    expect(branched.future).toHaveLength(0)
    expect(run(branched, { type: 'redo' })).toBe(branched)
  })

  it('does not record selection or marker changes', () => {
    const state = run(added, { type: 'select', id: null }, { type: 'markStart', time: 4 })
    expect(state.past).toHaveLength(added.past.length)
  })

  it('drops the selection when undo removes the selected clip', () => {
    expect(run(added, { type: 'undo' }).selectedId).toBeNull()
  })

  it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
    let state = loaded
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      state = run(state, { type: 'addClip', clip: { id: `c${i}`, start: i, end: i + 1 } })
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) state = run(state, { type: 'undo' })
    expect(state.clips).toHaveLength(10)
  })
})

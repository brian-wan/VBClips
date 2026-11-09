import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSavedSession,
  clearSessions,
  exportFileName,
  loadSession,
  parseSavedSession,
  saveSession,
  sessionKey,
  type KeyValueStore,
} from './persistence'

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

const video = { name: 'match.mp4', size: 10, lastModified: 5, duration: 60 }
const clips = [{ id: 'a', start: 1, end: 3 }]

describe('persistence', () => {
  let store: MemoryStore
  beforeEach(() => {
    store = new MemoryStore()
  })

  it('keys sessions by video fingerprint', () => {
    expect(sessionKey(video)).toBe('vbclipper:session:match.mp4|10|5')
  })

  it('round-trips a saved session', () => {
    const saved = buildSavedSession(video, clips, 12.5, 1000)
    saveSession(store, saved)
    expect(loadSession(store)).toEqual(saved)
  })

  it('keeps only one session', () => {
    saveSession(store, buildSavedSession(video, clips, 0, 1))
    saveSession(store, buildSavedSession({ ...video, name: 'other.mp4' }, [], 0, 2))
    expect(store.length).toBe(1)
    expect(loadSession(store)?.video.name).toBe('other.mp4')
  })

  it('clears saved sessions but leaves other keys', () => {
    store.setItem('unrelated', 'x')
    saveSession(store, buildSavedSession(video, clips, 0, 1))
    clearSessions(store)
    expect(loadSession(store)).toBeNull()
    expect(store.getItem('unrelated')).toBe('x')
  })

  it.each([
    ['null', null],
    ['bad json', '{'],
    ['wrong version', JSON.stringify({ ...buildSavedSession(video, clips, 0, 1), version: 2 })],
    ['bad clip', JSON.stringify({ ...buildSavedSession(video, clips, 0, 1), clips: [{ id: 1 }] })],
    ['missing video', JSON.stringify({ version: 1, clips: [], playhead: 0, savedAt: 0 })],
  ])('rejects %s', (_, raw) => {
    expect(parseSavedSession(raw)).toBeNull()
  })

  it('names the export after the video', () => {
    expect(exportFileName('match.mp4')).toBe('match.mp4.clips.json')
  })
})

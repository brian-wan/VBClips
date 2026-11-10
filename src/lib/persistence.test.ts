import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSavedSession,
  clearSessions,
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
const source = { id: 'match.mp4|10|5', ...video }
const second = {
  id: 'court2.mov|20|6',
  name: 'court2.mov',
  size: 20,
  lastModified: 6,
  duration: 30,
}
const clips = [
  { id: 'a', sourceId: source.id, start: 1, end: 3 },
  { id: 'b', sourceId: second.id, start: 2, end: 4 },
]

describe('persistence', () => {
  let store: MemoryStore
  beforeEach(() => {
    store = new MemoryStore()
  })

  it('keys sessions by the fingerprint of the first source', () => {
    expect(sessionKey({ sources: [source, second] })).toBe('vbclipper:session:match.mp4|10|5')
  })

  it('round-trips a version 2 session with several sources', () => {
    const saved = buildSavedSession([source, second], clips, 12.5, 1000)
    expect(saved.version).toBe(2)
    saveSession(store, saved)
    expect(loadSession(store)).toEqual(saved)
  })

  it('strips runtime fields when building a save', () => {
    const withExtras = { ...source, file: 'x' } as typeof source
    expect(buildSavedSession([withExtras], [], 0, 1).sources[0]).toEqual(source)
  })

  it('upgrades a version 1 save to one source', () => {
    const v1 = {
      version: 1,
      video,
      clips: [{ id: 'a', start: 1, end: 3 }],
      playhead: 7,
      savedAt: 3,
    }
    expect(parseSavedSession(JSON.stringify(v1))).toEqual({
      version: 2,
      sources: [source],
      clips: [{ id: 'a', sourceId: source.id, start: 1, end: 3 }],
      playhead: 7,
      savedAt: 3,
    })
  })

  it('drops clips whose source is not in the save', () => {
    const saved = buildSavedSession([source], clips, 0, 1)
    expect(parseSavedSession(JSON.stringify(saved))?.clips.map((c) => c.id)).toEqual(['a'])
  })

  it('keeps only one session', () => {
    saveSession(store, buildSavedSession([source], clips, 0, 1))
    saveSession(store, buildSavedSession([second, source], [], 0, 2))
    expect(store.length).toBe(1)
    expect(loadSession(store)?.sources[0].name).toBe('court2.mov')
  })

  it('clears saved sessions but leaves other keys', () => {
    store.setItem('unrelated', 'x')
    saveSession(store, buildSavedSession([source], clips, 0, 1))
    clearSessions(store)
    expect(loadSession(store)).toBeNull()
    expect(store.getItem('unrelated')).toBe('x')
  })

  const good = buildSavedSession([source], clips, 0, 1)
  it.each([
    ['null', null],
    ['bad json', '{'],
    ['unknown version', JSON.stringify({ ...good, version: 3 })],
    ['bad clip', JSON.stringify({ ...good, clips: [{ id: 1 }] })],
    ['clip without source', JSON.stringify({ ...good, clips: [{ id: 'a', start: 1, end: 2 }] })],
    ['no sources', JSON.stringify({ ...good, sources: [] })],
    ['bad source', JSON.stringify({ ...good, sources: [{ name: 'x' }] })],
    ['missing video', JSON.stringify({ version: 1, clips: [], playhead: 0, savedAt: 0 })],
  ])('rejects %s', (_, raw) => {
    expect(parseSavedSession(raw)).toBeNull()
  })
})

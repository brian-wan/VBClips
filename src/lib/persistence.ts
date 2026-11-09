import type { Clip } from './clips'
import { fingerprint } from './fingerprint'
import type { VideoMeta } from './session'

export type SavedSession = {
  version: 1
  video: VideoMeta
  clips: Clip[]
  playhead: number
  savedAt: number
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const KEY_PREFIX = 'vbclipper:session:'

export function sessionKey(video: VideoMeta): string {
  return KEY_PREFIX + fingerprint(video)
}

export function buildSavedSession(
  video: VideoMeta,
  clips: Clip[],
  playhead: number,
  savedAt: number,
): SavedSession {
  return {
    version: 1,
    video: { ...video },
    clips: clips.map(({ id, start, end }) => ({ id, start, end })),
    playhead,
    savedAt,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseSavedSession(raw: string | null): SavedSession | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const s = data as Record<string, unknown>
  const video = s.video as Record<string, unknown> | undefined
  if (s.version !== 1 || !video || !Array.isArray(s.clips)) return null
  if (typeof video.name !== 'string' || !isNum(video.size) || !isNum(video.lastModified)) {
    return null
  }
  if (!isNum(video.duration) || !isNum(s.playhead) || !isNum(s.savedAt)) return null
  const clipsValid = s.clips.every(
    (c: Record<string, unknown>) =>
      typeof c === 'object' &&
      c !== null &&
      typeof c.id === 'string' &&
      isNum(c.start) &&
      isNum(c.end),
  )
  if (!clipsValid) return null
  return data as SavedSession
}

function sessionKeys(store: KeyValueStore): string[] {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key?.startsWith(KEY_PREFIX)) keys.push(key)
  }
  return keys
}

/** Phase 1 keeps a single session: the most recently saved one wins. */
export function loadSession(store: KeyValueStore): SavedSession | null {
  return (
    sessionKeys(store)
      .map((key) => parseSavedSession(store.getItem(key)))
      .filter((s): s is SavedSession => s !== null)
      .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null
  )
}

export function saveSession(store: KeyValueStore, session: SavedSession): void {
  const key = sessionKey(session.video)
  for (const other of sessionKeys(store)) {
    if (other !== key) store.removeItem(other)
  }
  store.setItem(key, JSON.stringify(session))
}

export function clearSessions(store: KeyValueStore): void {
  for (const key of sessionKeys(store)) store.removeItem(key)
}

export function exportFileName(videoName: string): string {
  return `${videoName}.clips.json`
}

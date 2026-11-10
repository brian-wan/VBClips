import type { Clip } from './clips'
import { fingerprint } from './fingerprint'
import type { SourceMeta } from './session'

export type SavedSession = {
  version: 2
  /** In timeline order. */
  sources: SourceMeta[]
  clips: Clip[]
  /** Sequence time. */
  playhead: number
  savedAt: number
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const KEY_PREFIX = 'vbclipper:session:'

/** Sessions are stored under the fingerprint of their first source. */
export function sessionKey(session: Pick<SavedSession, 'sources'>): string {
  return KEY_PREFIX + (session.sources[0]?.id ?? '')
}

export function buildSavedSession(
  sources: readonly SourceMeta[],
  clips: readonly Clip[],
  playhead: number,
  savedAt: number,
): SavedSession {
  return {
    version: 2,
    sources: sources.map(({ id, name, size, lastModified, duration }) => ({
      id,
      name,
      size,
      lastModified,
      duration,
    })),
    clips: clips.map(({ id, sourceId, start, end }) => ({ id, sourceId, start, end })),
    playhead,
    savedAt,
  }
}

type Json = Record<string, unknown>

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null

function parseVideo(v: unknown): Omit<SourceMeta, 'id'> | null {
  if (!isObject(v)) return null
  const { name, size, lastModified, duration } = v
  if (typeof name !== 'string' || !isNum(size) || !isNum(lastModified) || !isNum(duration)) {
    return null
  }
  return { name, size, lastModified, duration }
}

function parseSource(v: unknown): SourceMeta | null {
  const video = parseVideo(v)
  if (!video || !isObject(v) || typeof v.id !== 'string') return null
  return { id: v.id, ...video }
}

const isClipShape = (c: unknown): c is Json =>
  isObject(c) && typeof c.id === 'string' && isNum(c.start) && isNum(c.end)

/** Version 1 saves held one video; they become a session with that video as its only source. */
function upgradeV1(s: Json): SavedSession | null {
  const video = parseVideo(s.video)
  if (!video || !Array.isArray(s.clips) || !s.clips.every(isClipShape)) return null
  const source = { id: fingerprint(video), ...video }
  return {
    version: 2,
    sources: [source],
    clips: s.clips.map((c) => ({
      id: c.id as string,
      sourceId: source.id,
      start: c.start as number,
      end: c.end as number,
    })),
    playhead: s.playhead as number,
    savedAt: s.savedAt as number,
  }
}

function parseV2(s: Json): SavedSession | null {
  if (!Array.isArray(s.sources) || s.sources.length === 0 || !Array.isArray(s.clips)) return null
  const sources = s.sources.map(parseSource)
  if (sources.some((source) => source === null)) return null
  const valid = sources as SourceMeta[]
  const ids = new Set(valid.map((source) => source.id))
  if (!s.clips.every((c) => isClipShape(c) && typeof c.sourceId === 'string')) return null
  return {
    version: 2,
    sources: valid,
    clips: (s.clips as Clip[])
      .filter((c) => ids.has(c.sourceId))
      .map(({ id, sourceId, start, end }) => ({ id, sourceId, start, end })),
    playhead: s.playhead as number,
    savedAt: s.savedAt as number,
  }
}

export function parseSavedSession(raw: string | null): SavedSession | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(data) || !isNum(data.playhead) || !isNum(data.savedAt)) return null
  if (data.version === 1) return upgradeV1(data)
  if (data.version === 2) return parseV2(data)
  return null
}

function sessionKeys(store: KeyValueStore): string[] {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key?.startsWith(KEY_PREFIX)) keys.push(key)
  }
  return keys
}

/** A single session is kept: the most recently saved one wins. */
export function loadSession(store: KeyValueStore): SavedSession | null {
  return (
    sessionKeys(store)
      .map((key) => parseSavedSession(store.getItem(key)))
      .filter((s): s is SavedSession => s !== null)
      .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null
  )
}

export function saveSession(store: KeyValueStore, session: SavedSession): void {
  const key = sessionKey(session)
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

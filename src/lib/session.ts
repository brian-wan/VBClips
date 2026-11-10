import {
  clamp,
  insertClip,
  isValidSpan,
  removeClip,
  replaceClip,
  sortClips,
  type Clip,
} from './clips'
import { fingerprint, type VideoIdentity } from './fingerprint'
import { moveSource } from './sequence'

export const HISTORY_LIMIT = 50

/** One picked video. `id` is its fingerprint, so picking the same file again finds it. */
export type SourceMeta = VideoIdentity & { id: string; duration: number }

/** What undo and redo restore. */
export type Snapshot = { sources: SourceMeta[]; clips: Clip[] }

/** The start of a clip being marked, in that source's local time. */
export type OpenMarker = { sourceId: string; time: number }

export type SessionState = Snapshot & {
  selectedId: string | null
  openStart: OpenMarker | null
  past: Snapshot[]
  future: Snapshot[]
}

export type SessionAction =
  | { type: 'load'; sources: SourceMeta[]; clips: Clip[] }
  | { type: 'markStart'; sourceId: string; time: number }
  | { type: 'markEnd'; sourceId: string; time: number; id: string }
  | { type: 'cancelMark' }
  | { type: 'updateClip'; clip: Clip }
  | { type: 'deleteClip'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'addSource'; source: SourceMeta }
  | { type: 'removeSource'; id: string }
  | { type: 'moveSource'; from: number; to: number }
  /** Puts back a deleted clip when undo would revert some later change instead. */
  | { type: 'restoreClip'; clip: Clip }
  /** Puts back a removed source at `index`, with the clips that went with it. */
  | { type: 'restoreSource'; source: SourceMeta; index: number; clips: Clip[] }
  | { type: 'undo' }
  | { type: 'redo' }

export const initialSession: SessionState = {
  sources: [],
  clips: [],
  selectedId: null,
  openStart: null,
  past: [],
  future: [],
}

export function sourceMeta(video: VideoIdentity, duration: number): SourceMeta {
  const { name, size, lastModified } = video
  return { id: fingerprint(video), name, size, lastModified, duration }
}

export type MarkEndProblem = 'noMarker' | 'otherSource' | 'tooShort'

/** Why ending the open marker at `time` in `sourceId` would not save a clip, or null if it would. */
export function markEndProblem(
  openStart: OpenMarker | null,
  sourceId: string,
  time: number,
): MarkEndProblem | null {
  if (openStart === null) return 'noMarker'
  if (openStart.sourceId !== sourceId) return 'otherSource'
  if (!isValidSpan(openStart.time, time)) return 'tooShort'
  return null
}

const order = (sources: readonly SourceMeta[]) => sources.map((s) => s.id)
const snapshot = (state: SessionState): Snapshot => ({
  sources: state.sources,
  clips: state.clips,
})

function commit(
  state: SessionState,
  next: Partial<Snapshot>,
  selectedId = state.selectedId,
): SessionState {
  const sources = next.sources ?? state.sources
  const clips = next.clips ?? state.clips
  return {
    ...state,
    sources,
    clips,
    selectedId: keepSelection(selectedId, clips),
    openStart: keepMarker(state.openStart, sources),
    past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
  }
}

function restore(state: SessionState, target: Snapshot): SessionState {
  return {
    ...state,
    ...target,
    selectedId: keepSelection(state.selectedId, target.clips),
    openStart: keepMarker(state.openStart, target.sources),
  }
}

function keepSelection(selectedId: string | null, clips: readonly Clip[]): string | null {
  return clips.some((c) => c.id === selectedId) ? selectedId : null
}

function keepMarker(marker: OpenMarker | null, sources: readonly SourceMeta[]): OpenMarker | null {
  return marker && sources.some((s) => s.id === marker.sourceId) ? marker : null
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'load': {
      const ids = new Set(action.sources.map((s) => s.id))
      const clips = action.clips.filter((c) => ids.has(c.sourceId))
      return {
        ...initialSession,
        sources: [...action.sources],
        clips: sortClips(clips, order(action.sources)),
      }
    }
    case 'markStart':
      return { ...state, openStart: { sourceId: action.sourceId, time: action.time } }
    case 'markEnd': {
      const open = state.openStart
      if (open === null || markEndProblem(open, action.sourceId, action.time) !== null) return state
      const clip = { id: action.id, sourceId: open.sourceId, start: open.time, end: action.time }
      const clips = insertClip(state.clips, clip, order(state.sources))
      return { ...commit(state, { clips }, clip.id), openStart: null }
    }
    case 'cancelMark':
      return { ...state, openStart: null }
    case 'updateClip': {
      const existing = state.clips.find((c) => c.id === action.clip.id)
      if (!existing || !isValidSpan(action.clip.start, action.clip.end)) return state
      if (existing.start === action.clip.start && existing.end === action.clip.end) return state
      const clip = { ...action.clip, sourceId: existing.sourceId }
      return commit(state, { clips: replaceClip(state.clips, clip, order(state.sources)) })
    }
    case 'deleteClip': {
      if (!state.clips.some((c) => c.id === action.id)) return state
      return commit(state, { clips: removeClip(state.clips, action.id) })
    }
    case 'select':
      return { ...state, selectedId: action.id }
    case 'addSource': {
      if (state.sources.some((s) => s.id === action.source.id)) return state
      return commit(state, { sources: [...state.sources, action.source] })
    }
    case 'removeSource': {
      if (!state.sources.some((s) => s.id === action.id)) return state
      return commit(state, {
        sources: state.sources.filter((s) => s.id !== action.id),
        clips: state.clips.filter((c) => c.sourceId !== action.id),
      })
    }
    case 'moveSource': {
      const { from, to } = action
      const count = state.sources.length
      if (from === to || from < 0 || to < 0 || from >= count || to >= count) return state
      const sources = moveSource(state.sources, from, to)
      return commit(state, { sources, clips: sortClips(state.clips, order(sources)) })
    }
    case 'restoreClip': {
      const { clip } = action
      if (state.clips.some((c) => c.id === clip.id)) return state
      if (!state.sources.some((s) => s.id === clip.sourceId)) return state
      return commit(state, { clips: insertClip(state.clips, clip, order(state.sources)) })
    }
    case 'restoreSource': {
      const { source } = action
      if (state.sources.some((s) => s.id === source.id)) return state
      const sources = [...state.sources]
      sources.splice(clamp(action.index, 0, sources.length), 0, source)
      const known = new Set(state.clips.map((c) => c.id))
      const returning = action.clips.filter((c) => c.sourceId === source.id && !known.has(c.id))
      return commit(state, {
        sources,
        clips: sortClips([...state.clips, ...returning], order(sources)),
      })
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...restore(state, previous),
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
      }
    }
    case 'redo': {
      const [next, ...future] = state.future
      if (!next) return state
      return {
        ...restore(state, next),
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future,
      }
    }
  }
}

import { insertClip, isValidSpan, removeClip, replaceClip, type Clip } from './clips'
import type { VideoIdentity } from './fingerprint'

export const HISTORY_LIMIT = 50

export type VideoMeta = VideoIdentity & { duration: number }

export type SessionState = {
  video: VideoMeta | null
  clips: Clip[]
  selectedId: string | null
  openStart: number | null
  past: Clip[][]
  future: Clip[][]
}

export type SessionAction =
  | { type: 'load'; video: VideoMeta; clips: Clip[] }
  | { type: 'setDuration'; duration: number }
  | { type: 'markStart'; time: number }
  | { type: 'markEnd'; time: number; id: string }
  | { type: 'cancelMark' }
  | { type: 'addClip'; clip: Clip }
  | { type: 'updateClip'; clip: Clip }
  | { type: 'deleteClip'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' }

export const initialSession: SessionState = {
  video: null,
  clips: [],
  selectedId: null,
  openStart: null,
  past: [],
  future: [],
}

export function canEndMark(openStart: number | null, time: number): boolean {
  return openStart !== null && isValidSpan(openStart, time)
}

function commit(state: SessionState, clips: Clip[], selectedId = state.selectedId): SessionState {
  return {
    ...state,
    clips,
    selectedId,
    past: [...state.past, state.clips].slice(-HISTORY_LIMIT),
    future: [],
  }
}

function keepSelection(selectedId: string | null, clips: Clip[]): string | null {
  return clips.some((c) => c.id === selectedId) ? selectedId : null
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'load':
      return { ...initialSession, video: action.video, clips: insertAll(action.clips) }
    case 'setDuration':
      return state.video
        ? { ...state, video: { ...state.video, duration: action.duration } }
        : state
    case 'markStart':
      return { ...state, openStart: action.time }
    case 'markEnd': {
      if (state.openStart === null || !canEndMark(state.openStart, action.time)) return state
      const clip = { id: action.id, start: state.openStart, end: action.time }
      return { ...commit(state, insertClip(state.clips, clip), clip.id), openStart: null }
    }
    case 'cancelMark':
      return { ...state, openStart: null }
    case 'addClip':
      return commit(state, insertClip(state.clips, action.clip), action.clip.id)
    case 'updateClip': {
      const existing = state.clips.find((c) => c.id === action.clip.id)
      if (!existing || !isValidSpan(action.clip.start, action.clip.end)) return state
      if (existing.start === action.clip.start && existing.end === action.clip.end) return state
      return commit(state, replaceClip(state.clips, action.clip))
    }
    case 'deleteClip': {
      if (!state.clips.some((c) => c.id === action.id)) return state
      const clips = removeClip(state.clips, action.id)
      return commit(state, clips, keepSelection(state.selectedId, clips))
    }
    case 'select':
      return { ...state, selectedId: action.id }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...state,
        clips: previous,
        selectedId: keepSelection(state.selectedId, previous),
        past: state.past.slice(0, -1),
        future: [state.clips, ...state.future].slice(0, HISTORY_LIMIT),
      }
    }
    case 'redo': {
      const [next, ...future] = state.future
      if (!next) return state
      return {
        ...state,
        clips: next,
        selectedId: keepSelection(state.selectedId, next),
        past: [...state.past, state.clips].slice(-HISTORY_LIMIT),
        future,
      }
    }
  }
}

function insertAll(clips: Clip[]): Clip[] {
  return clips.reduce<Clip[]>((acc, clip) => insertClip(acc, clip), [])
}

import { useCallback, useEffect, useRef } from 'react'
import { buildSavedSession, loadSession, saveSession } from '../lib/persistence'
import type { SessionState } from '../lib/session'
import { browserStore } from '../storage'

const SAVE_DELAY_MS = 300

/**
 * Saves the session 300 ms after each change to its sources or clips, and immediately on page
 * hide and unmount. Returns `saveNow` for explicit saves such as the back button.
 */
export function useSessionPersistence(state: SessionState, getPlayhead: () => number) {
  const latest = useRef({ state, getPlayhead })
  useEffect(() => {
    latest.current = { state, getPlayhead }
  })

  const saveNow = useCallback(() => {
    const { state, getPlayhead } = latest.current
    const store = browserStore()
    if (!store || state.sources.length === 0) return
    // Opening a video and leaving without marking anything must not replace another session.
    const existing = loadSession(store)
    const sameSession =
      existing !== null && existing.sources.some((s) => state.sources.some((t) => t.id === s.id))
    if (state.clips.length === 0 && !sameSession) return
    try {
      saveSession(store, buildSavedSession(state.sources, state.clips, getPlayhead(), Date.now()))
    } catch {
      // Storage full or blocked: the editor keeps working without persistence.
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(saveNow, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state.sources, state.clips, saveNow])

  useEffect(() => {
    window.addEventListener('pagehide', saveNow)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      saveNow()
    }
  }, [saveNow])

  return saveNow
}

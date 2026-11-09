import { useCallback, useEffect, useRef } from 'react'
import { sameVideo } from '../lib/fingerprint'
import { buildSavedSession, loadSession, saveSession } from '../lib/persistence'
import type { SessionState } from '../lib/session'
import { browserStore } from '../storage'

const SAVE_DELAY_MS = 300

/**
 * Saves the session 300 ms after each clip change, and immediately on page hide and unmount.
 * Returns `saveNow` for explicit saves such as the back button.
 */
export function useSessionPersistence(state: SessionState, getPlayhead: () => number) {
  const latest = useRef({ state, getPlayhead })
  useEffect(() => {
    latest.current = { state, getPlayhead }
  })

  const saveNow = useCallback(() => {
    const { state, getPlayhead } = latest.current
    const store = browserStore()
    if (!store || !state.video) return
    const existing = loadSession(store)
    const replacesSameVideo = existing !== null && sameVideo(existing.video, state.video)
    if (state.clips.length === 0 && !replacesSameVideo) return
    try {
      saveSession(store, buildSavedSession(state.video, state.clips, getPlayhead(), Date.now()))
    } catch {
      // Storage full or blocked: the editor keeps working without persistence.
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(saveNow, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state.clips, saveNow])

  useEffect(() => {
    window.addEventListener('pagehide', saveNow)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      saveNow()
    }
  }, [saveNow])

  return saveNow
}

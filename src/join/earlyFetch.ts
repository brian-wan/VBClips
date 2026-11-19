import { whenIdle } from '../lib/earlyFetch'
import { getFFmpeg } from './ffmpeg'

const saveData = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true

/**
 * Fetches the ffmpeg core at the first idle moment after the editor opens, so Join finds it in
 * hand. Only the files: the core is not started. Returns a function that cancels a fetch that
 * has not begun; one already running carries on for the page.
 */
export function scheduleEarlyFetch(): () => void {
  const idle = typeof window.requestIdleCallback === 'function'
  return whenIdle(
    () => {
      getFFmpeg()
        .prefetch()
        .catch((error: unknown) => console.warn('Early ffmpeg download failed', error))
    },
    {
      requestIdleCallback: idle ? (callback) => window.requestIdleCallback(callback) : undefined,
      cancelIdleCallback: idle ? (id) => window.cancelIdleCallback(id) : undefined,
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      saveData: saveData(),
    },
  )
}

let persistRequested = false

/**
 * Asks the browser once per page to keep this origin's storage (the service worker's cached core
 * and the staged copies) when it runs short of space. The answer is only logged.
 */
export function persistStorageOnce(): void {
  if (persistRequested) return
  persistRequested = true
  if (typeof navigator.storage?.persist !== 'function') return
  navigator.storage
    .persist()
    .then((granted) => console.info(`Persistent storage ${granted ? 'granted' : 'not granted'}`))
    .catch((error: unknown) => console.warn('Persistent storage request failed', error))
}

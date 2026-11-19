import type { OpenFailure } from '../playable'

const PROBE_TIMEOUT_MS = 15000

/**
 * Loads only the file's metadata in a detached video element and resolves to its duration, or
 * to why it could not: the browser cannot play it, or no answer came within 15 s (a file the
 * system is still fetching from iCloud, say). The file is streamed through an object URL, never
 * read into memory.
 */
export function probeDuration(file: File): Promise<number | OpenFailure> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false

    const finish = (duration: number | OpenFailure) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      const playable = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      resolve(playable || typeof duration === 'string' ? duration : 'unplayable')
    }

    const timer = window.setTimeout(() => finish('timeout'), PROBE_TIMEOUT_MS)
    video.muted = true
    video.preload = 'metadata'
    video.addEventListener('error', () => finish('unplayable'))
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration)) {
        finish(video.duration)
        return
      }
      // Some recorders write no duration; seeking far past the end makes the browser find it.
      video.addEventListener('durationchange', () => {
        if (Number.isFinite(video.duration)) finish(video.duration)
      })
      video.currentTime = Number.MAX_SAFE_INTEGER
    })
    video.src = url
  })
}

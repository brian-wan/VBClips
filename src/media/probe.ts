const PROBE_TIMEOUT_MS = 15000

/**
 * Loads only the file's metadata in a detached video element and resolves to its duration, or
 * null when the browser cannot play it. The file is streamed through an object URL, never read
 * into memory.
 */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false

    const finish = (duration: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null)
    }

    const timer = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS)
    video.muted = true
    video.preload = 'metadata'
    video.addEventListener('error', () => finish(null))
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

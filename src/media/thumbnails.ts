import { useEffect, useSyncExternalStore } from 'react'
import { roundThumbTime, thumbKey } from '../lib/filmstrip'

/** Frame height in device pixels; tiles are at most 56 CSS px tall, drawn at 2x. */
const FRAME_HEIGHT = 112
const SEEK_TIMEOUT_MS = 4000
const JPEG_QUALITY = 0.7

type Listener = () => void

/**
 * Pulls preview frames out of one source with its own hidden, muted video element, one seek at
 * a time in request order.
 */
class Extractor {
  readonly url: string
  private readonly video = document.createElement('video')
  private readonly canvas = document.createElement('canvas')
  private readonly queue: number[] = []
  private readonly ready: Promise<boolean>
  private running = false
  private disposed = false
  private readonly sourceId: string
  private readonly onFrame: (key: string, frame: string) => void
  private readonly has: (key: string) => boolean

  constructor(
    sourceId: string,
    url: string,
    has: (key: string) => boolean,
    onFrame: (key: string, frame: string) => void,
  ) {
    this.sourceId = sourceId
    this.url = url
    this.has = has
    this.onFrame = onFrame
    this.video.muted = true
    this.video.preload = 'metadata'
    this.ready = new Promise((resolve) => {
      this.video.addEventListener('loadedmetadata', () => resolve(true), { once: true })
      this.video.addEventListener('error', () => resolve(false), { once: true })
    })
    this.video.src = url
  }

  request(times: readonly number[], priority: boolean) {
    const wanted = times.map(roundThumbTime).filter((t) => !this.has(thumbKey(this.sourceId, t)))
    const fresh = wanted.filter((t, i) => wanted.indexOf(t) === i)
    if (priority) {
      const rest = this.queue.filter((t) => !fresh.includes(t))
      this.queue.splice(0, this.queue.length, ...fresh, ...rest)
    } else {
      for (const t of fresh) if (!this.queue.includes(t)) this.queue.push(t)
    }
    void this.run()
  }

  dispose() {
    this.disposed = true
    this.queue.length = 0
    this.video.removeAttribute('src')
    this.video.load()
  }

  private async run() {
    if (this.running) return
    this.running = true
    try {
      if (!(await this.ready)) return
      while (!this.disposed && this.queue.length > 0) {
        const t = this.queue.shift()!
        const key = thumbKey(this.sourceId, t)
        if (this.has(key)) continue
        const frame = await this.capture(t)
        if (frame && !this.disposed) this.onFrame(key, frame)
      }
    } finally {
      this.running = false
    }
  }

  private capture(t: number): Promise<string | null> {
    const video = this.video
    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer)
        video.removeEventListener('seeked', onSeeked)
        resolve(this.draw())
      }
      const onSeeked = () => done()
      const timer = window.setTimeout(() => {
        video.removeEventListener('seeked', onSeeked)
        resolve(null)
      }, SEEK_TIMEOUT_MS)
      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05))
    })
  }

  private draw(): string | null {
    const { videoWidth, videoHeight } = this.video
    if (!videoWidth || !videoHeight) return null
    const canvas = this.canvas
    canvas.height = FRAME_HEIGHT
    canvas.width = Math.round((FRAME_HEIGHT * videoWidth) / videoHeight)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(this.video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  }
}

/**
 * In-memory frame cache shared by the timeline and the trim strip, keyed by source id and time
 * rounded to a tenth of a second. Never persisted.
 */
class ThumbnailStore {
  private readonly frames = new Map<string, string>()
  private readonly extractors = new Map<string, Extractor>()
  private readonly listeners = new Set<Listener>()
  private version = 0
  private notifyScheduled = false

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  get(sourceId: string, t: number): string | undefined {
    return this.frames.get(thumbKey(sourceId, t))
  }

  request(sourceId: string, url: string, times: readonly number[], priority = false) {
    let extractor = this.extractors.get(sourceId)
    if (extractor && extractor.url !== url) {
      extractor.dispose()
      extractor = undefined
    }
    if (!extractor) {
      extractor = new Extractor(
        sourceId,
        url,
        (key) => this.frames.has(key),
        (key, frame) => {
          this.frames.set(key, frame)
          this.scheduleNotify()
        },
      )
      this.extractors.set(sourceId, extractor)
    }
    extractor.request(times, priority)
  }

  /** Stops extracting frames from sources not in `ids`; their cached frames stay. */
  retain(ids: ReadonlySet<string>) {
    for (const [id, extractor] of this.extractors) {
      if (ids.has(id)) continue
      extractor.dispose()
      this.extractors.delete(id)
    }
  }

  private scheduleNotify() {
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    requestAnimationFrame(() => {
      this.notifyScheduled = false
      this.version++
      this.listeners.forEach((listener) => listener())
    })
  }
}

export const thumbnails = new ThumbnailStore()

/** Frames for `times` of one source (undefined until each arrives), requested on mount. */
export function useThumbnails(
  sourceId: string,
  url: string | undefined,
  times: readonly number[],
  priority = false,
): (string | undefined)[] {
  useSyncExternalStore(thumbnails.subscribe, thumbnails.getVersion)
  const timesKey = times.join(',')
  useEffect(() => {
    if (url && timesKey)
      thumbnails.request(sourceId, url, timesKey.split(',').map(Number), priority)
  }, [sourceId, url, timesKey, priority])
  return times.map((t) => thumbnails.get(sourceId, t))
}

import { useEffect, useSyncExternalStore } from 'react'
import { roundThumbTime, thumbKey } from '../lib/filmstrip'

/** Frame height in device pixels; tiles are at most 56 CSS px tall, drawn at 2x. */
const FRAME_HEIGHT = 112
const SEEK_TIMEOUT_MS = 4000
const JPEG_QUALITY = 0.7

/**
 * Off-screen holder for the extractors' videos. Chrome may stop loading data for detached,
 * paused media elements, which stalls their seeks; elements in the document keep working.
 */
function hiddenHost(): HTMLElement {
  const existing = document.getElementById('thumbnail-videos')
  if (existing) return existing
  const host = document.createElement('div')
  host.id = 'thumbnail-videos'
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.append(host)
  return host
}

type Listener = () => void

/**
 * Pulls preview frames out of one source with its own hidden, muted video element, one seek at
 * a time. The timeline and the trim strip each keep one list of wanted times; a new request
 * replaces that list, so frames for a stale tile layout are never waited on. The trim strip's
 * list goes first.
 */
class Extractor {
  readonly url: string
  private readonly video = document.createElement('video')
  private readonly canvas = document.createElement('canvas')
  private queue: number[] = []
  private priorityQueue: number[] = []
  private readonly retried = new Set<number>()
  private readonly ready: Promise<boolean>
  private running = false
  private disposed = false
  private readonly sourceId: string
  private readonly onFrame: (key: string, frame: string) => void
  private readonly onMiss: (key: string) => void
  private readonly has: (key: string) => boolean

  constructor(
    sourceId: string,
    url: string,
    has: (key: string) => boolean,
    onFrame: (key: string, frame: string) => void,
    onMiss: (key: string) => void,
  ) {
    this.sourceId = sourceId
    this.url = url
    this.has = has
    this.onFrame = onFrame
    this.onMiss = onMiss
    this.video.muted = true
    this.video.preload = 'metadata'
    this.ready = new Promise((resolve) => {
      this.video.addEventListener('loadedmetadata', () => resolve(true), { once: true })
      this.video.addEventListener('error', () => resolve(false), { once: true })
    })
    this.video.src = url
    hiddenHost().append(this.video)
  }

  request(times: readonly number[], priority: boolean) {
    const wanted = times.map(roundThumbTime).filter((t) => !this.has(thumbKey(this.sourceId, t)))
    const fresh = wanted.filter((t, i) => wanted.indexOf(t) === i)
    if (priority) this.priorityQueue = fresh
    else this.queue = fresh
    void this.run()
  }

  dispose() {
    this.disposed = true
    this.queue = []
    this.priorityQueue = []
    this.video.removeAttribute('src')
    this.video.load()
    this.video.remove()
  }

  private async run() {
    if (this.running) return
    this.running = true
    try {
      if (!(await this.ready)) {
        for (const t of [...this.priorityQueue, ...this.queue]) {
          this.onMiss(thumbKey(this.sourceId, t))
        }
        this.priorityQueue = []
        this.queue = []
        return
      }
      while (!this.disposed) {
        const t = this.priorityQueue.shift() ?? this.queue.shift()
        if (t === undefined) break
        const key = thumbKey(this.sourceId, t)
        if (this.has(key)) continue
        const frame = await this.capture(t)
        if (this.disposed) break
        if (frame) this.onFrame(key, frame)
        else if (!this.retried.has(t)) {
          this.retried.add(t)
          this.queue.push(t)
        } else this.onMiss(key)
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
    try {
      context.drawImage(this.video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    } catch {
      return null
    }
  }
}

/**
 * In-memory frame cache shared by the timeline and the trim strip, keyed by source id and time
 * rounded to a tenth of a second. Never persisted.
 */
export type FrameProgress = { done: number; total: number }

class ThumbnailStore {
  private readonly frames = new Map<string, string>()
  /** Frames that failed twice; they count as done so progress can finish. */
  private readonly missed = new Set<string>()
  /** The timeline's latest wanted times per source. */
  private readonly wanted = new Map<string, number[]>()
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

  /** How many of `times` have a frame (or have been given up on). */
  progressOf(sourceId: string, times: readonly number[]): FrameProgress {
    const keys = new Set(times.map((t) => thumbKey(sourceId, t)))
    let done = 0
    for (const key of keys) if (this.frames.has(key) || this.missed.has(key)) done++
    return { done, total: keys.size }
  }

  /** Progress of the timeline's filmstrip frames for one source. */
  progress(sourceId: string): FrameProgress {
    return this.progressOf(sourceId, this.wanted.get(sourceId) ?? [])
  }

  request(sourceId: string, url: string, times: readonly number[], priority = false) {
    if (!priority) {
      this.wanted.set(sourceId, [...times])
      this.scheduleNotify()
    }
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
        (key) => {
          this.missed.add(key)
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
      this.wanted.delete(id)
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

/** Timeline frames done and wanted for one source, updated as frames land. */
export function useFrameProgress(sourceId: string): FrameProgress {
  useSyncExternalStore(thumbnails.subscribe, thumbnails.getVersion)
  return thumbnails.progress(sourceId)
}

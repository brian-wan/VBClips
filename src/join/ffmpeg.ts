import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import coreMtURL from '@ffmpeg/core-mt?url'
import wasmMtURL from '@ffmpeg/core-mt/wasm?url'
import workerMtURL from '@ffmpeg/core-mt/worker?url'
import type {
  DownloadListener,
  DownloadProgress,
  FFmpegLike,
  LogListener,
  ProgressListener,
} from '../lib/join/runner'

const MULTI_THREAD_TIMEOUT_MS = 8000
/** The single-thread core normally starts in well under a second. */
const SINGLE_THREAD_TIMEOUT_MS = 30_000
/** One read of the core download that brings nothing for this long fails the join. */
const DOWNLOAD_STALL_MS = 30_000
export const SINGLE_THREAD_FALLBACK_LOG =
  'Multi-thread core did not start; using the single-thread core'

/** The multi-thread core needs SharedArrayBuffer, which only a cross-origin isolated page has. */
function usesMultiThreadCore(): boolean {
  return typeof window !== 'undefined' && window.crossOriginIsolated
}

export type CoreConfig = { coreURL: string; wasmURL: string; workerURL?: string }

const absolute = (url: string) => new URL(url, window.location.href).href

function browserCoreConfig(multiThread: boolean): CoreConfig {
  if (multiThread) {
    return {
      coreURL: absolute(coreMtURL),
      wasmURL: absolute(wasmMtURL),
      workerURL: absolute(workerMtURL),
    }
  }
  return { coreURL: absolute(coreURL), wasmURL: absolute(wasmURL) }
}

/** Bytes in hand of one batch of files: received so far and the total, null when unknown. */
type BatchListener = (received: number, total: number | null) => void

/** Length of the bytes the reader will see; unknown when the body is compressed in transit. */
function contentLength(response: Response): number | null {
  const encoding = response.headers.get('Content-Encoding')
  if (encoding && encoding !== 'identity') return null
  const length = Number(response.headers.get('Content-Length'))
  return Number.isFinite(length) && length > 0 ? length : null
}

const TIMED_OUT = Symbol('timed out')

/** Settles like `promise`, or with TIMED_OUT once `ms` pass first. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Reads a response body chunk by chunk, reporting each chunk's size. A read that brings nothing
 * for `stallMs` fails with "The download stalled". Aborting `signal` cancels the reader at once,
 * even mid-read, and no chunk is reported after that.
 */
export async function readChunks(
  response: Response,
  onChunk: (bytes: number) => void,
  signal?: AbortSignal,
  stallMs = DOWNLOAD_STALL_MS,
): Promise<Uint8Array<ArrayBuffer>[]> {
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer())
    onChunk(whole.byteLength)
    return [whole]
  }
  const reader = response.body.getReader()
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array<ArrayBuffer>[] = []
  try {
    for (;;) {
      if (signal?.aborted) {
        cancel()
        signal.throwIfAborted()
      }
      const reading = reader.read()
      const outcome = await within(reading, stallMs)
      if (outcome === TIMED_OUT) {
        reading.catch(() => undefined)
        cancel()
        throw new Error('The download stalled')
      }
      signal?.throwIfAborted()
      const { done, value } = outcome
      if (done) return chunks
      chunks.push(value)
      onChunk(value.byteLength)
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

const coreFiles = (config: CoreConfig) =>
  [config.coreURL, config.wasmURL, config.workerURL].filter(
    (url): url is string => url !== undefined,
  )

const mimeType = (url: string) => (/\.wasm$/.test(url) ? 'application/wasm' : 'text/javascript')

export type CoreDownloaderOptions = {
  fetch?: (url: string, init: { signal?: AbortSignal | undefined }) => Promise<Response>
  createObjectURL?: (blob: Blob) => string
}

/** Core files being fetched together, which later callers can wait on and hear from. */
type Batch = {
  urls: ReadonlySet<string>
  received: number
  /** Unknown until every response has arrived; null when a server sent no Content-Length. */
  total: number | null | undefined
  listeners: Set<() => void>
  done: Promise<void>
}

/** Rejects with the signal's reason once it aborts. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason as Error)
    else signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
  })
}

/**
 * Fetches core files with progress and hands back blob URLs, the way `toBlobURL` in
 * `@ffmpeg/util` does. Blob URLs are kept for the page, so later loads (after Stop, or a
 * fallback that needs a file it already has) download nothing, and a file already being fetched
 * (by the early fetch when the editor opens) is waited on rather than fetched twice.
 */
export class CoreDownloader {
  private readonly fetch: (
    url: string,
    init: { signal?: AbortSignal | undefined },
  ) => Promise<Response>
  private readonly createObjectURL: (blob: Blob) => string
  private readonly blobURLs = new Map<string, string>()
  private readonly batches = new Set<Batch>()

  constructor(options: CoreDownloaderOptions = {}) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, { signal: init.signal ?? null }))
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob))
  }

  /** Whether every file of `config` is already in hand. */
  has(config: CoreConfig): boolean {
    return coreFiles(config).every((url) => this.blobURLs.has(url))
  }

  /**
   * Ends with a report whose total equals the bytes received (0 of 0 when every file was cached),
   * so the caller knows the last byte is in even when the server sent no Content-Length. Files
   * another caller is already fetching are joined, counting their bytes so far. Aborting
   * `signal` stops the fetches this call started and stops waiting on the others. When one file
   * fails or stalls, the others of its batch are cancelled too, and nothing is reported after
   * the download has failed.
   */
  async download(
    config: CoreConfig,
    onProgress?: BatchListener,
    signal?: AbortSignal,
  ): Promise<CoreConfig> {
    signal?.throwIfAborted()
    const missing = coreFiles(config).filter((url) => !this.blobURLs.has(url))
    const joined = [...this.batches].filter((batch) => missing.some((url) => batch.urls.has(url)))
    const uncovered = missing.filter((url) => !joined.some((batch) => batch.urls.has(url)))
    const involved = uncovered.length > 0 ? [...joined, this.start(uncovered, signal)] : joined

    let live = true
    const sum = () => involved.reduce((n, batch) => n + batch.received, 0)
    const total = () => {
      const totals = involved.map((batch) => batch.total)
      return totals.every((n) => typeof n === 'number')
        ? totals.reduce<number>((n, t) => n + t, 0)
        : null
    }
    const report = () => {
      if (!live || involved.some((batch) => batch.total === undefined)) return
      onProgress?.(sum(), total())
    }
    for (const batch of involved) batch.listeners.add(report)
    if (involved.length > 0) report()
    try {
      const all = Promise.all(involved.map((batch) => batch.done))
      await (signal ? Promise.race([all, aborted(signal)]) : all)
    } finally {
      live = false
      for (const batch of involved) batch.listeners.delete(report)
    }
    const received = sum()
    if (involved.length === 0 || received !== total()) onProgress?.(received, received)
    const blobURL = (url: string) => this.blobURLs.get(url) as string
    return {
      coreURL: blobURL(config.coreURL),
      wasmURL: blobURL(config.wasmURL),
      ...(config.workerURL ? { workerURL: blobURL(config.workerURL) } : {}),
    }
  }

  /** Starts fetching `urls` as one batch; `signal`, or any one file failing, stops all of them. */
  private start(urls: readonly string[], signal: AbortSignal | undefined): Batch {
    const controller = new AbortController()
    const forward = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', forward, { once: true })
    const batch: Batch = {
      urls: new Set(urls),
      received: 0,
      total: undefined,
      listeners: new Set(),
      done: Promise.resolve(),
    }
    batch.done = this.fetchAll(
      urls,
      (received, total) => {
        batch.received = received
        batch.total = total
        for (const listener of batch.listeners) listener()
      },
      controller.signal,
    )
      .catch((error: unknown) => {
        controller.abort(error)
        throw error
      })
      .finally(() => {
        signal?.removeEventListener('abort', forward)
        this.batches.delete(batch)
      })
    // Whoever started the batch may stop waiting on it; its failure is reported to the waiters.
    batch.done.catch(() => undefined)
    this.batches.add(batch)
    return batch
  }

  /** Fetches and reads `missing` side by side; `signal` stops all of them. */
  private async fetchAll(
    missing: readonly string[],
    onProgress: BatchListener,
    signal: AbortSignal,
  ): Promise<void> {
    const responses = await Promise.all(
      missing.map(async (url) => {
        const response = await this.fetch(url, { signal })
        if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`)
        return { url, response }
      }),
    )
    const lengths = responses.map(({ response }) => contentLength(response))
    const total = lengths.every((n) => n !== null)
      ? lengths.reduce<number>((sum, n) => sum + (n ?? 0), 0)
      : null
    let received = 0
    const report = () => {
      if (!signal.aborted) onProgress(received, total)
    }
    report()
    await Promise.all(
      responses.map(async ({ url, response }) => {
        const chunks = await readChunks(
          response,
          (bytes) => {
            received += bytes
            report()
          },
          signal,
        )
        const blob = new Blob(chunks, { type: mimeType(url) })
        this.blobURLs.set(url, this.createObjectURL(blob))
      }),
    )
  }
}

const pageDownloader = new CoreDownloader()

/** The parts of `@ffmpeg/ffmpeg`'s `FFmpeg` class the adapter calls. */
export type FFmpegCore = Pick<
  FFmpeg,
  | 'loaded'
  | 'load'
  | 'exec'
  | 'ffprobe'
  | 'readFile'
  | 'writeFile'
  | 'deleteFile'
  | 'createDir'
  | 'mount'
  | 'unmount'
  | 'on'
  | 'terminate'
>

/** Shared by every adapter in the page, so one failed multi-thread start is not retried. */
export type CoreChoice = { singleThreadOnly: boolean }
const pageCoreChoice: CoreChoice = { singleThreadOnly: false }

export type BrowserFFmpegOptions = {
  createFFmpeg?: () => FFmpegCore
  multiThread?: () => boolean
  coreConfig?: (multiThread: boolean) => CoreConfig
  timeoutMs?: number
  /** How long the single-thread core may take to start before the join fails. */
  singleThreadTimeoutMs?: number
  choice?: CoreChoice
  /** Turns the core's asset URLs into blob URLs, reporting download progress. */
  download?: (
    config: CoreConfig,
    onProgress?: BatchListener,
    signal?: AbortSignal,
  ) => Promise<CoreConfig>
}

/**
 * Wraps `@ffmpeg/ffmpeg`, serving the core from the app's own assets. Listeners live here rather
 * than on the `FFmpeg` instance, because a fallback replaces the instance.
 */
export class BrowserFFmpeg implements FFmpegLike {
  private readonly createFFmpeg: () => FFmpegCore
  private readonly multiThread: () => boolean
  private readonly coreConfig: (multiThread: boolean) => CoreConfig
  private readonly timeoutMs: number
  private readonly singleThreadTimeoutMs: number
  private readonly choice: CoreChoice
  private readonly downloadCore: (
    config: CoreConfig,
    onProgress?: BatchListener,
    signal?: AbortSignal,
  ) => Promise<CoreConfig>
  private readonly logListeners = new Set<LogListener>()
  private readonly progressListeners = new Set<ProgressListener>()
  private ffmpeg: FFmpegCore

  constructor(options: BrowserFFmpegOptions = {}) {
    this.createFFmpeg = options.createFFmpeg ?? (() => new FFmpeg())
    this.multiThread = options.multiThread ?? usesMultiThreadCore
    this.coreConfig = options.coreConfig ?? browserCoreConfig
    this.timeoutMs = options.timeoutMs ?? MULTI_THREAD_TIMEOUT_MS
    this.singleThreadTimeoutMs = options.singleThreadTimeoutMs ?? SINGLE_THREAD_TIMEOUT_MS
    this.choice = options.choice ?? pageCoreChoice
    this.downloadCore =
      options.download ??
      ((config, onProgress, signal) => pageDownloader.download(config, onProgress, signal))
    this.ffmpeg = this.freshFFmpeg()
  }

  private freshFFmpeg(): FFmpegCore {
    const ffmpeg = this.createFFmpeg()
    ffmpeg.on('log', (event) => this.logListeners.forEach((listener) => listener(event)))
    ffmpeg.on('progress', (event) => this.progressListeners.forEach((listener) => listener(event)))
    return ffmpeg
  }

  /** Multi-thread unless the page is not isolated or the multi-thread core failed to start. */
  private multiThreadCore(): boolean {
    return !this.choice.singleThreadOnly && this.multiThread()
  }

  /**
   * Fetches the files the next `load` would start, by the same rule, without starting anything:
   * no worker, no core. A later load finds them in hand, or joins the fetch still running.
   */
  async prefetch(): Promise<void> {
    if (this.ffmpeg.loaded) return
    await this.downloadCore(this.coreConfig(this.multiThreadCore()))
  }

  private emitLog(message: string) {
    this.logListeners.forEach((listener) => listener({ type: 'info', message }))
  }

  /**
   * Starts the core from `config`. Checks `signal` first and hands it to the library, so a Stop
   * between the last downloaded byte and the core answering rejects the load.
   */
  private startCore(config: CoreConfig, signal: AbortSignal | undefined) {
    signal?.throwIfAborted()
    return this.ffmpeg.load(config, signal ? { signal } : {})
  }

  /**
   * Downloads the core (once per page) and starts it. The 8 s limit applies to starting the
   * multi-thread core, not to the download before it, which is bound by the network. The
   * single-thread core gets 30 s to start; after that the load fails with "ffmpeg did not start".
   */
  async load(onProgress?: DownloadListener, signal?: AbortSignal) {
    if (this.ffmpeg.loaded) return
    // A fallback downloads a second set of files; report both batches as one download.
    let sofar: DownloadProgress = { received: 0, total: 0 }
    const fetchCore = (multiThread: boolean) => {
      const before = sofar
      return this.downloadCore(
        this.coreConfig(multiThread),
        (received, total) => {
          sofar = {
            received: before.received + received,
            total: before.total === null || total === null ? null : before.total + total,
          }
          onProgress?.(sofar)
        },
        signal,
      )
    }
    const startSingleThread = async () => {
      const loading = this.startCore(await fetchCore(false), signal)
      if ((await within(loading, this.singleThreadTimeoutMs)) !== TIMED_OUT) return
      loading.catch(() => undefined)
      this.ffmpeg.terminate()
      throw new Error('ffmpeg did not start')
    }

    if (!this.multiThreadCore()) {
      await startSingleThread()
      return
    }

    const loading = this.startCore(await fetchCore(true), signal)
    if ((await within(loading, this.timeoutMs)) !== TIMED_OUT) return

    loading.catch(() => undefined)
    this.ffmpeg.terminate()
    this.choice.singleThreadOnly = true
    this.ffmpeg = this.freshFFmpeg()
    this.emitLog(SINGLE_THREAD_FALLBACK_LOG)
    await startSingleThread()
  }

  async mount(file: File, mountPoint: string) {
    await this.ffmpeg.createDir(mountPoint).catch(() => undefined)
    await this.ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountPoint)
  }

  async unmount(mountPoint: string) {
    await this.ffmpeg.unmount(mountPoint)
  }

  exec(args: string[]) {
    return this.ffmpeg.exec(args)
  }

  ffprobe(args: string[]) {
    return this.ffmpeg.ffprobe(args)
  }

  async readFile(path: string) {
    const data = await this.ffmpeg.readFile(path)
    if (typeof data === 'string') throw new Error(`Expected binary data in ${path}`)
    return data
  }

  async writeFile(path: string, data: string) {
    await this.ffmpeg.writeFile(path, data)
  }

  async deleteFile(path: string) {
    await this.ffmpeg.deleteFile(path)
  }

  on(event: 'log' | 'progress', listener: LogListener | ProgressListener) {
    if (event === 'log') this.logListeners.add(listener as LogListener)
    else this.progressListeners.add(listener as ProgressListener)
  }

  off(event: 'log' | 'progress', listener: LogListener | ProgressListener) {
    if (event === 'log') this.logListeners.delete(listener as LogListener)
    else this.progressListeners.delete(listener as ProgressListener)
  }

  terminate() {
    this.ffmpeg.terminate()
  }
}

let shared: BrowserFFmpeg | null = null

/** One instance for the app, so the 30 MB core loads once and is reused across joins. */
export function getFFmpeg(): BrowserFFmpeg {
  shared ??= new BrowserFFmpeg()
  return shared
}

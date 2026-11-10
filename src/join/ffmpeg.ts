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
 * for `stallMs` fails with "The download stalled".
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
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined)
      signal.throwIfAborted()
    }
    const reading = reader.read()
    const outcome = await within(reading, stallMs)
    if (outcome === TIMED_OUT) {
      reading.catch(() => undefined)
      await reader.cancel().catch(() => undefined)
      throw new Error('The download stalled')
    }
    const { done, value } = outcome
    if (done) return chunks
    chunks.push(value as Uint8Array<ArrayBuffer>)
    onChunk(value.byteLength)
  }
}

const mimeType = (url: string) => (/\.wasm$/.test(url) ? 'application/wasm' : 'text/javascript')

export type CoreDownloaderOptions = {
  fetch?: (url: string, init: { signal?: AbortSignal }) => Promise<Response>
  createObjectURL?: (blob: Blob) => string
}

/**
 * Fetches core files with progress and hands back blob URLs, the way `toBlobURL` in
 * `@ffmpeg/util` does. Blob URLs are kept for the page, so later loads (after Stop, or a
 * fallback that needs a file it already has) download nothing.
 */
export class CoreDownloader {
  private readonly fetch: (url: string, init: { signal?: AbortSignal }) => Promise<Response>
  private readonly createObjectURL: (blob: Blob) => string
  private readonly blobURLs = new Map<string, string>()

  constructor(options: CoreDownloaderOptions = {}) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob))
  }

  /**
   * Ends with a report whose total equals the bytes received (0 of 0 when every file was cached),
   * so the caller knows the last byte is in even when the server sent no Content-Length.
   * Aborting `signal` stops the fetches and the readers.
   */
  async download(
    config: CoreConfig,
    onProgress?: BatchListener,
    signal?: AbortSignal,
  ): Promise<CoreConfig> {
    const urls = [config.coreURL, config.wasmURL, config.workerURL].filter(
      (url): url is string => url !== undefined,
    )
    signal?.throwIfAborted()
    const missing = urls.filter((url) => !this.blobURLs.has(url))
    let received = 0
    let total: number | null = 0
    if (missing.length > 0) {
      const responses = await Promise.all(
        missing.map(async (url) => {
          const response = await this.fetch(url, { signal })
          if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`)
          return response
        }),
      )
      const lengths = responses.map(contentLength)
      total = lengths.every((n) => n !== null)
        ? lengths.reduce<number>((sum, n) => sum + (n ?? 0), 0)
        : null
      onProgress?.(received, total)
      await Promise.all(
        responses.map(async (response, i) => {
          const chunks = await readChunks(
            response,
            (bytes) => {
              received += bytes
              onProgress?.(received, total)
            },
            signal,
          )
          const blob = new Blob(chunks, { type: mimeType(missing[i]) })
          this.blobURLs.set(missing[i], this.createObjectURL(blob))
        }),
      )
    }
    if (missing.length === 0 || received !== total) onProgress?.(received, received)
    const blobURL = (url: string) => this.blobURLs.get(url) as string
    return {
      coreURL: blobURL(config.coreURL),
      wasmURL: blobURL(config.wasmURL),
      ...(config.workerURL ? { workerURL: blobURL(config.workerURL) } : {}),
    }
  }
}

const pageDownloader = new CoreDownloader()

/** The parts of `@ffmpeg/ffmpeg`'s `FFmpeg` class the adapter calls. */
export type FFmpegCore = Pick<
  FFmpeg,
  | 'loaded'
  | 'load'
  | 'exec'
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

    if (this.choice.singleThreadOnly || !this.multiThread()) {
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
export function getFFmpeg(): FFmpegLike {
  shared ??= new BrowserFFmpeg()
  return shared
}

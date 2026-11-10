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

export const MULTI_THREAD_TIMEOUT_MS = 8000
export const SINGLE_THREAD_FALLBACK_LOG =
  'Multi-thread core did not start; using the single-thread core'

/** The multi-thread core needs SharedArrayBuffer, which only a cross-origin isolated page has. */
export function usesMultiThreadCore(): boolean {
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
export function contentLength(response: Response): number | null {
  const encoding = response.headers.get('Content-Encoding')
  if (encoding && encoding !== 'identity') return null
  const length = Number(response.headers.get('Content-Length'))
  return Number.isFinite(length) && length > 0 ? length : null
}

/** Reads a response body chunk by chunk, reporting each chunk's size. */
export async function readChunks(
  response: Response,
  onChunk: (bytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>[]> {
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer())
    onChunk(whole.byteLength)
    return [whole]
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value as Uint8Array<ArrayBuffer>)
    onChunk(value.byteLength)
  }
}

const mimeType = (url: string) => (/\.wasm$/.test(url) ? 'application/wasm' : 'text/javascript')

export type CoreDownloaderOptions = {
  fetch?: (url: string) => Promise<Response>
  createObjectURL?: (blob: Blob) => string
}

/**
 * Fetches core files with progress and hands back blob URLs, as `@ffmpeg/util`'s `toBlobURL`
 * does. Blob URLs are kept for the page, so later loads (after Stop, or a fallback that needs a
 * file it already has) download nothing.
 */
export class CoreDownloader {
  private readonly fetch: (url: string) => Promise<Response>
  private readonly createObjectURL: (blob: Blob) => string
  private readonly blobURLs = new Map<string, string>()

  constructor(options: CoreDownloaderOptions = {}) {
    this.fetch = options.fetch ?? ((url) => fetch(url))
    this.createObjectURL = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob))
  }

  async download(config: CoreConfig, onProgress?: BatchListener): Promise<CoreConfig> {
    const urls = [config.coreURL, config.wasmURL, config.workerURL].filter(
      (url): url is string => url !== undefined,
    )
    const missing = urls.filter((url) => !this.blobURLs.has(url))
    if (missing.length > 0) {
      const responses = await Promise.all(
        missing.map(async (url) => {
          const response = await this.fetch(url)
          if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`)
          return response
        }),
      )
      const lengths = responses.map(contentLength)
      const total = lengths.every((n) => n !== null)
        ? lengths.reduce<number>((sum, n) => sum + (n ?? 0), 0)
        : null
      let received = 0
      onProgress?.(received, total)
      await Promise.all(
        responses.map(async (response, i) => {
          const chunks = await readChunks(response, (bytes) => {
            received += bytes
            onProgress?.(received, total)
          })
          const blob = new Blob(chunks, { type: mimeType(missing[i]) })
          this.blobURLs.set(missing[i], this.createObjectURL(blob))
        }),
      )
    }
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
  choice?: CoreChoice
  /** Turns the core's asset URLs into blob URLs, reporting download progress. */
  download?: (config: CoreConfig, onProgress?: BatchListener) => Promise<CoreConfig>
}

const TIMED_OUT = Symbol('timed out')

/**
 * Wraps `@ffmpeg/ffmpeg`, serving the core from the app's own assets. Listeners live here rather
 * than on the `FFmpeg` instance, because a fallback replaces the instance.
 */
export class BrowserFFmpeg implements FFmpegLike {
  private readonly createFFmpeg: () => FFmpegCore
  private readonly multiThread: () => boolean
  private readonly coreConfig: (multiThread: boolean) => CoreConfig
  private readonly timeoutMs: number
  private readonly choice: CoreChoice
  private readonly downloadCore: (
    config: CoreConfig,
    onProgress?: BatchListener,
  ) => Promise<CoreConfig>
  private readonly logListeners = new Set<LogListener>()
  private readonly progressListeners = new Set<ProgressListener>()
  private ffmpeg: FFmpegCore

  constructor(options: BrowserFFmpegOptions = {}) {
    this.createFFmpeg = options.createFFmpeg ?? (() => new FFmpeg())
    this.multiThread = options.multiThread ?? usesMultiThreadCore
    this.coreConfig = options.coreConfig ?? browserCoreConfig
    this.timeoutMs = options.timeoutMs ?? MULTI_THREAD_TIMEOUT_MS
    this.choice = options.choice ?? pageCoreChoice
    this.downloadCore =
      options.download ?? ((config, onProgress) => pageDownloader.download(config, onProgress))
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
   * Downloads the core (once per page) and starts it. The 8 s limit applies to starting the
   * multi-thread core, not to the download before it, which is bound by the network.
   */
  async load(onProgress?: DownloadListener) {
    if (this.ffmpeg.loaded) return
    // A fallback downloads a second set of files; report both batches as one download.
    let sofar: DownloadProgress = { received: 0, total: 0 }
    const fetchCore = (multiThread: boolean) => {
      const before = sofar
      return this.downloadCore(this.coreConfig(multiThread), (received, total) => {
        sofar = {
          received: before.received + received,
          total: before.total === null || total === null ? null : before.total + total,
        }
        onProgress?.(sofar)
      })
    }

    if (this.choice.singleThreadOnly || !this.multiThread()) {
      await this.ffmpeg.load(await fetchCore(false))
      return
    }

    const config = await fetchCore(true)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs)
    })
    const loading = this.ffmpeg.load(config)
    const outcome = await Promise.race([loading, timeout]).finally(() => clearTimeout(timer))
    if (outcome !== TIMED_OUT) return

    loading.catch(() => undefined)
    this.ffmpeg.terminate()
    this.choice.singleThreadOnly = true
    this.ffmpeg = this.freshFFmpeg()
    this.emitLog(SINGLE_THREAD_FALLBACK_LOG)
    await this.ffmpeg.load(await fetchCore(false))
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

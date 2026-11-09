import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import coreMtURL from '@ffmpeg/core-mt?url'
import wasmMtURL from '@ffmpeg/core-mt/wasm?url'
import workerMtURL from '@ffmpeg/core-mt/worker?url'
import type { FFmpegLike, LogListener, ProgressListener } from '../lib/join/runner'

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
  private readonly logListeners = new Set<LogListener>()
  private readonly progressListeners = new Set<ProgressListener>()
  private ffmpeg: FFmpegCore

  constructor(options: BrowserFFmpegOptions = {}) {
    this.createFFmpeg = options.createFFmpeg ?? (() => new FFmpeg())
    this.multiThread = options.multiThread ?? usesMultiThreadCore
    this.coreConfig = options.coreConfig ?? browserCoreConfig
    this.timeoutMs = options.timeoutMs ?? MULTI_THREAD_TIMEOUT_MS
    this.choice = options.choice ?? pageCoreChoice
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

  async load() {
    if (this.ffmpeg.loaded) return
    if (this.choice.singleThreadOnly || !this.multiThread()) {
      await this.ffmpeg.load(this.coreConfig(false))
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs)
    })
    const loading = this.ffmpeg.load(this.coreConfig(true))
    const outcome = await Promise.race([loading, timeout]).finally(() => clearTimeout(timer))
    if (outcome !== TIMED_OUT) return

    loading.catch(() => undefined)
    this.ffmpeg.terminate()
    this.choice.singleThreadOnly = true
    this.ffmpeg = this.freshFFmpeg()
    this.emitLog(SINGLE_THREAD_FALLBACK_LOG)
    await this.ffmpeg.load(this.coreConfig(false))
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

import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import coreMtURL from '@ffmpeg/core-mt?url'
import wasmMtURL from '@ffmpeg/core-mt/wasm?url'
import workerMtURL from '@ffmpeg/core-mt/worker?url'
import type { FFmpegLike, LogListener, ProgressListener } from '../lib/join/runner'

/** The multi-thread core needs SharedArrayBuffer, which only a cross-origin isolated page has. */
export function usesMultiThreadCore(): boolean {
  return typeof window !== 'undefined' && window.crossOriginIsolated
}

const absolute = (url: string) => new URL(url, window.location.href).href

function coreConfig() {
  if (usesMultiThreadCore()) {
    return {
      coreURL: absolute(coreMtURL),
      wasmURL: absolute(wasmMtURL),
      workerURL: absolute(workerMtURL),
    }
  }
  return { coreURL: absolute(coreURL), wasmURL: absolute(wasmURL) }
}

/** Wraps `@ffmpeg/ffmpeg`, serving the core from the app's own assets. */
class BrowserFFmpeg implements FFmpegLike {
  private ffmpeg = new FFmpeg()

  async load() {
    if (!this.ffmpeg.loaded) await this.ffmpeg.load(coreConfig())
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
    if (event === 'log') this.ffmpeg.on('log', listener as LogListener)
    else this.ffmpeg.on('progress', listener as ProgressListener)
  }

  off(event: 'log' | 'progress', listener: LogListener | ProgressListener) {
    if (event === 'log') this.ffmpeg.off('log', listener as LogListener)
    else this.ffmpeg.off('progress', listener as ProgressListener)
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

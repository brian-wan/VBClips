import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadProgress } from '../lib/join/runner'
import {
  BrowserFFmpeg,
  CoreDownloader,
  SINGLE_THREAD_FALLBACK_LOG,
  readChunks,
  type CoreChoice,
  type CoreConfig,
  type FFmpegCore,
} from './ffmpeg'

type Listener = (event: { type: string; message: string }) => void

/** Which core loads never answer: none, the multi-thread one, or every one. */
type Hang = boolean | 'all'

class FakeCore {
  loaded = false
  terminated = false
  loads: CoreConfig[] = []
  loadSignals: (AbortSignal | undefined)[] = []
  private listeners: Listener[] = []
  private rejectLoad: ((reason: Error) => void) | null = null

  private readonly hang: Hang

  constructor(hang: Hang) {
    this.hang = hang
  }

  load = (config: CoreConfig, options: { signal?: AbortSignal } = {}) => {
    this.loads.push(config)
    this.loadSignals.push(options.signal)
    if (this.hang === 'all' || (config.workerURL && this.hang)) {
      return new Promise<boolean>((_, reject) => {
        this.rejectLoad = reject
      })
    }
    this.loaded = true
    return Promise.resolve(true)
  }
  on = (event: string, listener: Listener) => {
    if (event === 'log') this.listeners.push(listener)
  }
  emit(message: string) {
    this.listeners.forEach((l) => l({ type: 'stderr', message }))
  }
  terminate = () => {
    this.terminated = true
    this.loaded = false
    this.rejectLoad?.(new Error('called FFmpeg.terminate()'))
  }
}

const config = (multiThread: boolean): CoreConfig =>
  multiThread
    ? { coreURL: 'mt.js', wasmURL: 'mt.wasm', workerURL: 'mt.worker.js' }
    : { coreURL: 'st.js', wasmURL: 'st.wasm' }

/** A response whose body arrives in `chunks`, with or without a Content-Length header. */
function streamed(chunks: number[], withLength: boolean): Response {
  const total = chunks.reduce((sum, n) => sum + n, 0)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })
  return new Response(body, {
    headers: withLength ? { 'Content-Length': String(total) } : {},
  })
}

function fakeServer(files: Record<string, number[]>, withLength = true) {
  const fetched: string[] = []
  const blobs = new Map<string, Blob>()
  const downloader = new CoreDownloader({
    fetch: (url, { signal }) => {
      if (signal?.aborted) return Promise.reject(signal.reason as Error)
      fetched.push(url)
      return Promise.resolve(streamed(files[url] ?? [], withLength))
    },
    createObjectURL: (blob) => {
      const url = `blob:${blobs.size}`
      blobs.set(url, blob)
      return url
    },
  })
  return { downloader, fetched, blobs }
}

const files = {
  'st.js': [100],
  'st.wasm': [400, 500],
  'mt.js': [100],
  'mt.wasm': [600, 600],
  'mt.worker.js': [10],
}

describe('CoreDownloader', () => {
  it('reports bytes per chunk against the Content-Length total and returns blob URLs', async () => {
    const { downloader, blobs } = fakeServer(files)
    const reports: [number, number | null][] = []
    const urls = await downloader.download(config(false), (received, total) =>
      reports.push([received, total]),
    )
    expect(reports[0]).toEqual([0, 1000])
    expect(reports.at(-1)).toEqual([1000, 1000])
    expect(reports.map(([received]) => received)).toEqual(
      [...reports.map(([received]) => received)].sort((a, b) => a - b),
    )
    expect(reports).toHaveLength(4)
    expect(Object.keys(urls)).toEqual(['coreURL', 'wasmURL'])
    expect(blobs.get(urls.wasmURL)?.size).toBe(900)
    expect(blobs.get(urls.wasmURL)?.type).toBe('application/wasm')
    expect(blobs.get(urls.coreURL)?.type).toBe('text/javascript')
  })

  it('reports a null total when the server sends no Content-Length', async () => {
    const { downloader } = fakeServer(files, false)
    const reports: [number, number | null][] = []
    await downloader.download(config(true), (received, total) => reports.push([received, total]))
    expect(reports.slice(0, -1).every(([, total]) => total === null)).toBe(true)
    expect(reports.at(-2)).toEqual([1310, null])
    // The last report closes the download with a known total.
    expect(reports.at(-1)).toEqual([1310, 1310])
  })

  it('keeps blob URLs for the page, so a second load downloads nothing', async () => {
    const { downloader, fetched } = fakeServer(files)
    const first = await downloader.download(config(false))
    const reports: [number, number | null][] = []
    const second = await downloader.download(config(false), (received, total) =>
      reports.push([received, total]),
    )
    expect(second).toEqual(first)
    expect(fetched).toEqual(['st.js', 'st.wasm'])
    expect(reports).toEqual([[0, 0]])
  })

  it('stops reading when the signal aborts and keeps nothing', async () => {
    const { downloader, blobs } = fakeServer(files)
    const controller = new AbortController()
    const downloading = downloader.download(
      config(false),
      (received) => {
        if (received > 0) controller.abort()
      },
      controller.signal,
    )
    await expect(downloading).rejects.toThrow(/abort/i)
    expect(blobs.size).toBe(0)
    await expect(downloader.download(config(false), undefined, controller.signal)).rejects.toThrow(
      /abort/i,
    )
  })

  it('fails when a read brings nothing for 30 s', async () => {
    vi.useFakeTimers()
    try {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(10))
        },
        cancel() {
          cancelled = true
        },
      })
      const chunks: number[] = []
      const reading = readChunks(new Response(body), (bytes) => chunks.push(bytes))
      const outcome = expect(reading).rejects.toThrow('The download stalled')
      await vi.advanceTimersByTimeAsync(29_999)
      expect(chunks).toEqual([10])
      await vi.advanceTimersByTimeAsync(1)
      await outcome
      expect(cancelled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails on an HTTP error', async () => {
    const downloader = new CoreDownloader({
      fetch: () => Promise.resolve(new Response('missing', { status: 404 })),
    })
    await expect(downloader.download(config(false))).rejects.toThrow(/HTTP 404/)
  })
})

function setup(
  hang: Hang,
  choice: CoreChoice = { singleThreadOnly: false },
  download?: (
    config: CoreConfig,
    onProgress?: (r: number, t: number | null) => void,
    signal?: AbortSignal,
  ) => Promise<CoreConfig>,
) {
  const cores: FakeCore[] = []
  const adapter = new BrowserFFmpeg({
    createFFmpeg: () => {
      const core = new FakeCore(hang)
      cores.push(core)
      return core as unknown as FFmpegCore
    },
    multiThread: () => true,
    coreConfig: config,
    timeoutMs: 8000,
    choice,
    download: download ?? ((urls) => Promise.resolve(urls)),
  })
  const logs: string[] = []
  adapter.on('log', ({ message }: { message: string }) => logs.push(message))
  return { adapter, cores, logs, choice }
}

describe('BrowserFFmpeg.load', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses the multi-thread core when it starts', async () => {
    const { adapter, cores, logs, choice } = setup(false)
    await adapter.load()
    expect(cores).toHaveLength(1)
    expect(cores[0]?.loads).toEqual([config(true)])
    expect(logs).toEqual([])
    expect(choice.singleThreadOnly).toBe(false)
  })

  it('falls back to the single-thread core when the multi-thread load times out', async () => {
    const { adapter, cores, logs, choice } = setup(true)
    const loading = adapter.load()
    await vi.advanceTimersByTimeAsync(7999)
    expect(cores).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    await loading
    expect(cores[0]?.terminated).toBe(true)
    expect(cores).toHaveLength(2)
    expect(cores[1]?.loads).toEqual([config(false)])
    expect(cores[1]?.loaded).toBe(true)
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG])
    expect(choice.singleThreadOnly).toBe(true)
  })

  it('remembers the single-thread choice for later loads', async () => {
    const { adapter, cores, logs, choice } = setup(true)
    const loading = adapter.load()
    await vi.advanceTimersByTimeAsync(8000)
    await loading

    adapter.terminate()
    await adapter.load()
    expect(cores).toHaveLength(2)
    expect(cores[1]?.loads).toEqual([config(false), config(false)])

    const other = setup(true, choice)
    await other.adapter.load()
    expect(other.cores[0]?.loads).toEqual([config(false)])
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG])
    expect(other.logs).toEqual([])
  })

  it('forwards core log lines from the replacement instance', async () => {
    const { adapter, cores, logs } = setup(true)
    const loading = adapter.load()
    await vi.advanceTimersByTimeAsync(8000)
    await loading
    cores[1]?.emit('ffmpeg version 5.1.4')
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG, 'ffmpeg version 5.1.4'])
  })

  it('reports the download, then starts the core from blob URLs', async () => {
    const { downloader } = fakeServer(files)
    const { adapter, cores } = setup(false, undefined, (c, p) => downloader.download(c, p))
    const reports: DownloadProgress[] = []
    await adapter.load((progress) => reports.push(progress))
    expect(reports.at(-1)).toEqual({ received: 1310, total: 1310 })
    expect(cores[0]?.loads[0]?.wasmURL).toMatch(/^blob:/)

    adapter.terminate()
    reports.length = 0
    await adapter.load((progress) => reports.push(progress))
    expect(reports).toEqual([{ received: 0, total: 0 }])
  })

  it('passes the abort signal to the download', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const { adapter } = setup(false, undefined, (urls, _, signal) => {
      signals.push(signal)
      return Promise.resolve(urls)
    })
    const controller = new AbortController()
    await adapter.load(undefined, controller.signal)
    expect(signals).toEqual([controller.signal])
  })

  it('fails when the single-thread core does not start in 30 s', async () => {
    const { adapter, cores } = setup('all', { singleThreadOnly: true })
    const loading = adapter.load()
    const outcome = expect(loading).rejects.toThrow('ffmpeg did not start')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(cores[0]?.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(cores[0]?.terminated).toBe(true)
  })

  it('gives the single-thread core its own 30 s after a multi-thread timeout', async () => {
    const { adapter, cores, logs } = setup('all')
    const loading = adapter.load()
    const outcome = expect(loading).rejects.toThrow('ffmpeg did not start')
    await vi.advanceTimersByTimeAsync(8000)
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG])
    await vi.advanceTimersByTimeAsync(30_000)
    await outcome
    expect(cores.map((c) => c.terminated)).toEqual([true, true])
  })

  it('hands the signal to the core load and checks it just before', async () => {
    const controller = new AbortController()
    const { adapter, cores } = setup(false, undefined, (urls) => {
      controller.abort()
      return Promise.resolve(urls)
    })
    await expect(adapter.load(undefined, controller.signal)).rejects.toThrow(/abort/i)
    expect(cores[0]?.loads).toEqual([])

    const other = setup(false)
    const live = new AbortController()
    await other.adapter.load(undefined, live.signal)
    expect(other.cores[0]?.loadSignals).toEqual([live.signal])
  })

  it('counts the single-thread files on top of the multi-thread ones after a timeout', async () => {
    const { downloader, fetched } = fakeServer(files)
    const { adapter, cores } = setup(true, undefined, (c, p) => downloader.download(c, p))
    const reports: DownloadProgress[] = []
    const loading = adapter.load((progress) => reports.push(progress))
    await vi.advanceTimersByTimeAsync(8000)
    await loading
    expect(fetched).toEqual(['mt.js', 'mt.wasm', 'mt.worker.js', 'st.js', 'st.wasm'])
    expect(reports.at(-1)).toEqual({ received: 2310, total: 2310 })
    expect(reports.map((r) => r.received)).toEqual(
      [...reports.map((r) => r.received)].sort((a, b) => a - b),
    )
    expect(cores[1]?.loads[0]?.coreURL).toMatch(/^blob:/)
  })
})

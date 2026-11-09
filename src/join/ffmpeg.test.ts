import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserFFmpeg,
  SINGLE_THREAD_FALLBACK_LOG,
  type CoreChoice,
  type CoreConfig,
  type FFmpegCore,
} from './ffmpeg'

type Listener = (event: { type: string; message: string }) => void

class FakeCore {
  loaded = false
  terminated = false
  loads: CoreConfig[] = []
  private listeners: Listener[] = []
  private rejectLoad: ((reason: Error) => void) | null = null

  private readonly hangOnMultiThread: boolean

  constructor(hangOnMultiThread: boolean) {
    this.hangOnMultiThread = hangOnMultiThread
  }

  load = (config: CoreConfig) => {
    this.loads.push(config)
    if (config.workerURL && this.hangOnMultiThread) {
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

function setup(hangOnMultiThread: boolean, choice: CoreChoice = { singleThreadOnly: false }) {
  const cores: FakeCore[] = []
  const adapter = new BrowserFFmpeg({
    createFFmpeg: () => {
      const core = new FakeCore(hangOnMultiThread)
      cores.push(core)
      return core as unknown as FFmpegCore
    },
    multiThread: () => true,
    coreConfig: config,
    timeoutMs: 8000,
    choice,
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
    expect(cores[0].loads).toEqual([config(true)])
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
    expect(cores[0].terminated).toBe(true)
    expect(cores).toHaveLength(2)
    expect(cores[1].loads).toEqual([config(false)])
    expect(cores[1].loaded).toBe(true)
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
    expect(cores[1].loads).toEqual([config(false), config(false)])

    const other = setup(true, choice)
    await other.adapter.load()
    expect(other.cores[0].loads).toEqual([config(false)])
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG])
    expect(other.logs).toEqual([])
  })

  it('forwards core log lines from the replacement instance', async () => {
    const { adapter, cores, logs } = setup(true)
    const loading = adapter.load()
    await vi.advanceTimersByTimeAsync(8000)
    await loading
    cores[1].emit('ffmpeg version 5.1.4')
    expect(logs).toEqual([SINGLE_THREAD_FALLBACK_LOG, 'ffmpeg version 5.1.4'])
  })
})

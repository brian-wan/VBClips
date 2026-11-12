import { describe, expect, it, vi } from 'vitest'
import { probeArgs, segmentArgs, type Segment } from './plan'
import { RATES_KEY } from './progress'
import {
  FALLBACK_REASON,
  STALLED_MESSAGE,
  JoinCancelled,
  JoinError,
  nextFrame,
  runJoin,
  type DownloadListener,
  type JoinOptions,
  type Scheduler,
  type DownloadProgress,
  type FFmpegLike,
  type JoinEvent,
  type LogListener,
  type ProgressListener,
  type StageListener,
  type Stager,
} from './runner'

type Call = { method: string; args: unknown[] }
type ExecHandler = (args: string[], fake: FakeFFmpeg) => number | Promise<number>
/**
 * What ffprobe of a segment does: write this JSON, or write nothing and exit with this code.
 * Like the real core, a probe that writes JSON still exits -1.
 */
type ProbeHandler = (segment: string) => string | number | Promise<string | number>

/** ffprobe's JSON for a segment whose video starts `videoStart` s after time 0. */
const probeJson = (containerStart: number, videoStart: number, videoDuration: number) =>
  JSON.stringify({
    streams: [
      { codec_type: 'video', start_time: String(videoStart), duration: String(videoDuration) },
      { codec_type: 'audio', start_time: String(containerStart), duration: '1.000000' },
    ],
    format: { start_time: String(containerStart) },
  })

class FakeFFmpeg implements FFmpegLike {
  calls: Call[] = []
  files = new Map<string, string>()
  logListeners = new Set<LogListener>()
  progressListeners = new Set<ProgressListener>()
  loaded = false
  loads = 0
  /** Chunks the next cold load reports, as a core download would. */
  download: DownloadProgress[] = []
  downloadListeners: (DownloadListener | undefined)[] = []
  private pending: ((reason: Error) => void)[] = []

  private handler: ExecHandler
  /** Exits 1 unless a test sets it, so the concat list has no durations. */
  probe: ProbeHandler = () => 1

  constructor(handler: ExecHandler = () => 0) {
    this.handler = handler
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args })
  }

  methods() {
    return this.calls.map((c) => c.method)
  }

  execArgs() {
    return this.calls.filter((c) => c.method === 'exec').map((c) => c.args[0] as string[])
  }

  emitProgress(time: number) {
    this.progressListeners.forEach((l) => l({ progress: 0, time }))
  }

  emitLog(message: string) {
    this.logListeners.forEach((l) => l({ type: 'stderr', message }))
  }

  /** When set, a cold load waits for it, like a core download in progress. */
  downloading: Promise<void> | null = null
  loadSignals: (AbortSignal | undefined)[] = []

  async load(onProgress?: DownloadListener, signal?: AbortSignal) {
    this.record('load')
    this.downloadListeners.push(onProgress)
    this.loadSignals.push(signal)
    if (!this.loaded) {
      this.loads++
      this.download.forEach((chunk) => onProgress?.(chunk))
      this.download = []
      await this.downloading
    }
    this.loaded = true
  }
  mount(file: File, mountPoint: string) {
    this.record('mount', file.name, mountPoint)
    return Promise.resolve()
  }
  unmount(mountPoint: string) {
    this.record('unmount', mountPoint)
    return Promise.resolve()
  }
  exec(args: string[]): Promise<number> {
    this.record('exec', args)
    return new Promise((resolve, reject) => {
      this.pending.push(reject)
      Promise.resolve(this.handler(args, this)).then((code) => {
        const output = args.at(-1)
        if (code === 0 && output) this.files.set(output, 'data')
        resolve(code)
      }, reject)
    })
  }
  ffprobe(args: string[]): Promise<number> {
    this.record('ffprobe', args)
    return new Promise((resolve, reject) => {
      this.pending.push(reject)
      const segment = args[args.indexOf('-o') - 1] ?? ''
      Promise.resolve(this.probe(segment)).then((result) => {
        if (typeof result === 'number') return resolve(result)
        this.files.set(args.at(-1) ?? '', result)
        resolve(-1)
      }, reject)
    })
  }
  readFile(path: string) {
    this.record('readFile', path)
    const content = this.files.get(path)
    if (content === undefined) return Promise.reject(new Error(`missing ${path}`))
    if (content === 'data') return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    return Promise.resolve(new TextEncoder().encode(content))
  }
  writeFile(path: string, data: string) {
    this.record('writeFile', path, data)
    this.files.set(path, data)
    return Promise.resolve()
  }
  deleteFile(path: string) {
    this.record('deleteFile', path)
    this.files.delete(path)
    return Promise.resolve()
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
    this.record('terminate')
    this.loaded = false
    this.pending.forEach((reject) => reject(new Error('called FFmpeg.terminate()')))
    this.pending = []
  }
}

/** Delivers every event at once, so tests see each change. */
const immediately: Scheduler = (flush) => {
  flush()
  return () => undefined
}
const run = (options: JoinOptions & { ffmpeg: FFmpegLike }) =>
  runJoin({ schedule: immediately, ...options })

const file = new File(['x'], 'game.mp4', { type: 'video/mp4' })
const files = [file]
const first: Segment = { sourceIndex: 0, start: 0, end: 10 }
const second: Segment = { sourceIndex: 0, start: 20, end: 50 }
const segments = [first, second]
const isConcat = (args: string[]) => args.includes('concat')

describe('runJoin', () => {
  it('mounts the source, cuts each segment, concatenates and returns the output', async () => {
    const ffmpeg = new FakeFFmpeg()
    const blob = await run({ ffmpeg, files, segments, mode: 'fast' })

    expect(blob.size).toBe(4)
    expect(blob.type).toBe('video/mp4')
    expect(ffmpeg.calls[0]?.method).toBe('load')
    expect(ffmpeg.calls[1]).toEqual({ method: 'mount', args: ['game.mp4', '/in0'] })
    expect(ffmpeg.execArgs()).toEqual([
      segmentArgs('fast', first, 0, '/in0/game.mp4'),
      segmentArgs('fast', second, 1, '/in0/game.mp4'),
      ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'],
    ])
    expect(ffmpeg.calls).toContainEqual({
      method: 'writeFile',
      args: ['list.txt', "file 'seg0.mp4'\nfile 'seg1.mp4'\n"],
    })
    expect(ffmpeg.methods().at(-1)).toBe('unmount')
  })

  it('probes each segment after its cut and lines the next video up in the concat list', async () => {
    const ffmpeg = new FakeFFmpeg()
    // Fast cuts start at a keyframe, so segment 0 holds 10.3 s of video 30 ms after its audio.
    const timings: Record<string, string> = {
      'seg0.mp4': probeJson(0, 0.03, 10.3),
      'seg1.mp4': probeJson(0, 0.01, 30.2),
    }
    ffmpeg.probe = (segment) => timings[segment] ?? 1
    await run({ ffmpeg, files, segments, mode: 'fast' })

    const order = ffmpeg.calls
      .filter((c) => c.method === 'exec' || c.method === 'ffprobe')
      .map((c) => `${c.method} ${(c.args[0] as string[]).at(-1) ?? ''}`)
    expect(order).toEqual([
      'exec seg0.mp4',
      'ffprobe probe.json',
      'exec seg1.mp4',
      'ffprobe probe.json',
      'exec out.mp4',
    ])
    expect(ffmpeg.calls.filter((c) => c.method === 'ffprobe').map((c) => c.args[0])).toEqual([
      probeArgs(0),
      probeArgs(1),
    ])
    expect(ffmpeg.calls).toContainEqual({
      method: 'writeFile',
      args: ['list.txt', "file 'seg0.mp4'\nduration 10.320\nfile 'seg1.mp4'\nduration 30.200\n"],
    })
    expect([...ffmpeg.files.keys()]).toEqual([])
  })

  it('probes Precise segments too', async () => {
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.probe = (segment) =>
      segment === 'seg0.mp4' ? probeJson(0.043, 0.066, 10) : probeJson(0.01, 0.066, 30)
    await run({ ffmpeg, files, segments, mode: 'precise' })
    expect(ffmpeg.calls).toContainEqual({
      method: 'writeFile',
      args: ['list.txt', "file 'seg0.mp4'\nduration 9.967\nfile 'seg1.mp4'\nduration 30.000\n"],
    })
  })

  it('writes no duration for a segment whose probe fails, and still joins', async () => {
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.probe = (segment) => {
      if (segment === 'seg0.mp4') return 1
      if (segment === 'seg1.mp4') return 'not json'
      return probeJson(0, 0, 5)
    }
    const third: Segment = { sourceIndex: 0, start: 60, end: 65 }
    const blob = await run({ ffmpeg, files, segments: [first, second, third], mode: 'fast' })
    expect(blob.size).toBe(4)
    expect(ffmpeg.calls).toContainEqual({
      method: 'writeFile',
      args: ['list.txt', "file 'seg0.mp4'\nfile 'seg1.mp4'\nfile 'seg2.mp4'\nduration 5.000\n"],
    })
    expect([...ffmpeg.files.keys()]).toEqual([])
  })

  it('treats a probe that throws like a failed one', async () => {
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.probe = () => Promise.reject(new Error('probe crashed'))
    const blob = await run({ ffmpeg, files, segments, mode: 'fast' })
    expect(blob.size).toBe(4)
  })

  it('stops when Stop lands during a probe', async () => {
    const controller = new AbortController()
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.probe = () => {
      controller.abort()
      return new Promise<number>(() => undefined)
    }
    const joining = run({ ffmpeg, files, segments, mode: 'fast', signal: controller.signal })
    await expect(joining).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.execArgs()).toHaveLength(1)
  })

  it('finishes when the concat logs the expected Non-monotonic DTS warning', async () => {
    const warning =
      '[mp4 @ 0x1] Non-monotonic DTS in output stream 0:1; previous: 529152, current: 529151; changing to 529153.'
    const ffmpeg = new FakeFFmpeg((args, fake) => {
      if (isConcat(args)) fake.emitLog(warning)
      return 0
    })
    const events: JoinEvent[] = []
    const blob = await run({
      ffmpeg,
      files,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    })
    expect(blob.size).toBe(4)
    expect(events.at(-1)?.phase).toBe('done')
  })

  it('mounts every source and cuts segments from their own source in sequence order', async () => {
    const court = new File(['y'], 'court2.mov', { type: 'video/quicktime' })
    const fromCourt: Segment = { sourceIndex: 1, start: 5, end: 8 }
    const fromGame: Segment = { sourceIndex: 0, start: 1, end: 3 }
    const ffmpeg = new FakeFFmpeg()
    await run({ ffmpeg, files: [file, court], segments: [fromCourt, fromGame], mode: 'fast' })

    expect(ffmpeg.calls.filter((c) => c.method === 'mount').map((c) => c.args)).toEqual([
      ['game.mp4', '/in0'],
      ['court2.mov', '/in1'],
    ])
    expect(ffmpeg.execArgs().slice(0, 2)).toEqual([
      segmentArgs('fast', fromCourt, 0, '/in1/court2.mov'),
      segmentArgs('fast', fromGame, 1, '/in0/game.mp4'),
    ])
    expect(ffmpeg.calls.filter((c) => c.method === 'unmount').map((c) => c.args[0])).toEqual([
      '/in0',
      '/in1',
    ])
  })

  it('falls back to precise across sources when the fast concat fails', async () => {
    const court = new File(['y'], 'court2.mov', { type: 'video/quicktime' })
    const fromGame: Segment = { sourceIndex: 0, start: 1, end: 3 }
    const fromCourt: Segment = { sourceIndex: 1, start: 5, end: 8 }
    let concats = 0
    const ffmpeg = new FakeFFmpeg((args) => (isConcat(args) && concats++ === 0 ? 1 : 0))
    await run({ ffmpeg, files: [file, court], segments: [fromGame, fromCourt], mode: 'fast' })
    expect(ffmpeg.execArgs()[4]).toEqual(segmentArgs('precise', fromCourt, 1, '/in1/court2.mov'))
  })

  it('leaves nothing behind in MEMFS', async () => {
    const ffmpeg = new FakeFFmpeg()
    await run({ ffmpeg, files, segments, mode: 'precise' })
    expect([...ffmpeg.files.keys()]).toEqual([])
  })

  it('deletes the segment files after concat, before reading the output', async () => {
    const ffmpeg = new FakeFFmpeg()
    await run({ ffmpeg, files, segments, mode: 'precise' })
    const firstArg = (arg: unknown) =>
      Array.isArray(arg) ? arg.join(',') : typeof arg === 'string' ? arg : ''
    const methods = ffmpeg.calls.map((c) => `${c.method} ${firstArg(c.args[0])}`)
    const concat = methods.findIndex((m) => m.startsWith('exec -f,concat'))
    const read = methods.indexOf('readFile out.mp4')
    for (const path of ['seg0.mp4', 'seg1.mp4', 'list.txt']) {
      const deleted = methods.indexOf(`deleteFile ${path}`)
      expect(deleted).toBeGreaterThan(concat)
      expect(deleted).toBeLessThan(read)
    }
    expect(methods.indexOf('deleteFile out.mp4')).toBeGreaterThan(read)
  })

  it('gives each phase its share of the expected time', async () => {
    const events: JoinEvent[] = []
    await run({
      ffmpeg: new FakeFFmpeg(),
      files,
      segments,
      mode: 'fast',
      now: () => 0,
      onEvent: (e) => events.push(e),
    })
    // Fast at 20x cuts 10 s and 30 s in 2 s; the 40 s concat at 40x takes 1 s: a third.
    const concat = events.find((e) => e.phase === 'concat')?.progress ?? NaN
    const save = events.find((e) => e.phase === 'save')?.progress ?? NaN
    expect(save - concat).toBeCloseTo(1 / 3, 2)
  })

  it('forwards concat progress', async () => {
    const ffmpeg = new FakeFFmpeg((args, fake) => {
      if (isConcat(args)) fake.emitProgress(20_000_000)
      return 0
    })
    const events: JoinEvent[] = []
    await run({
      ffmpeg,
      files,
      segments,
      mode: 'fast',
      now: () => 0,
      onEvent: (e) => events.push(e),
    })
    const concat = events.filter((e) => e.phase === 'concat').map((e) => e.progress)
    expect(concat).toHaveLength(2)
    expect(concat[1]).toBeCloseTo(2.5 / 3)
  })

  it('reports the core download with bytes in the label', async () => {
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.download = [
      { received: 0, total: 31.5e6 },
      { received: 12.3e6, total: 31.5e6 },
      { received: 31.5e6, total: 31.5e6 },
    ]
    const events: JoinEvent[] = []
    await run({
      ffmpeg,
      files,
      segments,
      mode: 'precise',
      now: () => 0,
      onEvent: (e) => events.push(e),
    })
    const download = events.filter((e) => e.phase === 'download')
    expect(download.map((e) => e.label)).toEqual([
      'Loading ffmpeg',
      'Downloading ffmpeg · 0.0 of 31.5 MB',
      'Downloading ffmpeg · 12.3 of 31.5 MB',
    ])
    expect(events.find((e) => e.phase === 'start')?.label).toBe('Starting ffmpeg')
    expect(download[2]?.progress).toBeGreaterThan(0)
    expect(ffmpeg.downloadListeners[0]).toBeTypeOf('function')
  })

  it('never lowers progress except on a fallback, and stores learned rates', async () => {
    let clock = 0
    const store = new Map<string, string>()
    const ffmpeg = new FakeFFmpeg((args, fake) => {
      if (isConcat(args)) return 0
      // 1 media second per wall second, reported every second.
      const seg = args.at(-1) === 'seg0.mp4' ? first : second
      for (let t = 1; t <= seg.end - seg.start; t++) {
        clock += 1000
        fake.emitProgress(t * 1_000_000)
      }
      return 0
    })
    const events: JoinEvent[] = []
    await run({
      ffmpeg,
      files,
      segments,
      mode: 'precise',
      now: () => clock,
      store: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
        key: () => null,
        length: 0,
      },
      onEvent: (e) => events.push(e),
    })
    const progress = events.map((e) => e.progress)
    progress.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(progress[i - 1] ?? 0))
    const stored = JSON.parse(store.get(RATES_KEY) ?? '{}') as { precise?: number }
    expect(stored.precise).toBeCloseTo(1)
    expect(events.find((e) => e.remainingSeconds !== null)).toBeDefined()
  })

  it('forwards log lines and keeps them for errors', async () => {
    const ffmpeg = new FakeFFmpeg((_, fake) => {
      fake.emitLog('Invalid data found when processing input')
      return 1
    })
    const logs: string[] = []
    const error = await run({
      ffmpeg,
      files,
      segments,
      mode: 'precise',
      onEvent: (e) => e.log && logs.push(e.log),
    }).catch((e: unknown) => e)

    expect(logs).toEqual(['Invalid data found when processing input'])
    expect(error).toBeInstanceOf(JoinError)
    expect((error as JoinError).mode).toBe('precise')
    expect((error as JoinError).log).toEqual(['Invalid data found when processing input'])
    expect((error as JoinError).message).toMatch(/segment 1/)
  })

  it('reports a fast segment failure without falling back', async () => {
    const ffmpeg = new FakeFFmpeg((args) => (args.at(-1) === 'seg1.mp4' ? 1 : 0))
    const error = await run({ ffmpeg, files, segments, mode: 'fast' }).catch((e: unknown) => e)
    expect((error as JoinError).mode).toBe('fast')
    // A Fast cut that fails is worth trying again with Precise.
    expect((error as JoinError).retryable).toBe(true)
    expect(ffmpeg.execArgs()).toHaveLength(2)
    expect(ffmpeg.files.size).toBe(0)
  })

  it('falls back to precise when the fast concat fails', async () => {
    let concats = 0
    const ffmpeg = new FakeFFmpeg((args) => (isConcat(args) && concats++ === 0 ? 1 : 0))
    const events: JoinEvent[] = []
    const blob = await run({
      ffmpeg,
      files,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    })

    expect(blob.size).toBe(4)
    const execs = ffmpeg.execArgs()
    expect(execs).toHaveLength(6)
    expect(execs[3]).toEqual(segmentArgs('precise', first, 0, '/in0/game.mp4'))
    expect(events.find((e) => e.phase === 'fallback')).toMatchObject({
      mode: 'precise',
      log: FALLBACK_REASON,
      label: 'Switched to Precise: re-encoding',
      progress: 0,
    })
    const afterFallback = events.slice(events.findIndex((e) => e.phase === 'fallback'))
    expect(afterFallback.find((e) => e.phase === 'cut')?.label).toBe(
      'Switched to Precise: re-encoding clip 1 of 2',
    )
    // The reason is said once; the events after it carry no log line.
    expect(afterFallback.slice(1).filter((e) => e.log)).toEqual([])
    expect(events.at(-1)).toMatchObject({ phase: 'done', mode: 'precise' })
    expect(ffmpeg.files.size).toBe(0)
  })

  it('fails when the precise concat fails', async () => {
    const ffmpeg = new FakeFFmpeg((args) => (isConcat(args) ? 1 : 0))
    const error = await run({ ffmpeg, files, segments, mode: 'precise' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JoinError)
    expect((error as JoinError).message).toMatch(/combine/)
    expect(ffmpeg.execArgs()).toHaveLength(3)
  })

  it('terminates ffmpeg on abort and reloads the core on the next run', async () => {
    const controller = new AbortController()
    let hang = true
    const ffmpeg = new FakeFFmpeg((args) => {
      if (!hang || args.at(-1) !== 'seg1.mp4') return 0
      controller.abort()
      return new Promise<number>(() => undefined)
    })
    const first = run({ ffmpeg, files, segments, mode: 'precise', signal: controller.signal })
    await expect(first).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.methods()).toContain('terminate')
    expect(ffmpeg.methods()).not.toContain('unmount')
    expect(ffmpeg.progressListeners.size).toBe(0)
    expect(ffmpeg.logListeners.size).toBe(0)

    hang = false
    const blob = await run({ ffmpeg, files, segments, mode: 'precise' })
    expect(blob.size).toBe(4)
    expect(ffmpeg.loads).toBe(2)
  })

  it('stops during the core download without mounting anything', async () => {
    let finishDownload = () => undefined as void
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.download = [{ received: 10e6, total: 32.8e6 }]
    ffmpeg.downloading = new Promise((resolve) => {
      finishDownload = resolve
    })
    const controller = new AbortController()
    const joining = run({ ffmpeg, files, segments, mode: 'precise', signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    // The page-side download may still finish after Stop; the join must not go on.
    finishDownload()
    await expect(joining).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.loadSignals).toEqual([controller.signal])
    expect(ffmpeg.methods()).not.toContain('mount')
    expect(ffmpeg.execArgs()).toEqual([])
  })

  it('ticks the estimate while the core starts', async () => {
    vi.useFakeTimers()
    try {
      let clock = 0
      let started = () => undefined as void
      const ffmpeg = new FakeFFmpeg()
      ffmpeg.download = [{ received: 32.8e6, total: 32.8e6 }]
      ffmpeg.downloading = new Promise((resolve) => {
        started = resolve
      })
      const events: JoinEvent[] = []
      const joining = run({
        ffmpeg,
        files,
        segments,
        mode: 'precise',
        now: () => clock,
        onEvent: (e) => events.push(e),
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(events.at(-1)).toMatchObject({ phase: 'start', label: 'Starting ffmpeg' })
      expect(events.at(-1)?.remainingSeconds).toBeNull()
      clock = 4000
      await vi.advanceTimersByTimeAsync(250)
      expect(events.at(-1)).toMatchObject({ phase: 'start' })
      expect(events.at(-1)?.remainingSeconds).toBeGreaterThan(0)
      started()
      await joining
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces events into one per frame', async () => {
    const frames: (() => void)[] = []
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.download = Array.from({ length: 1000 }, (_, i) => ({
      received: (i + 1) * 32_800,
      total: 32.8e6,
    }))
    let finishDownload = () => undefined as void
    ffmpeg.downloading = new Promise((resolve) => {
      finishDownload = resolve
    })
    const events: JoinEvent[] = []
    const joining = runJoin({
      ffmpeg,
      files,
      segments,
      mode: 'fast',
      schedule: (flush) => {
        frames.push(flush)
        return () => frames.splice(frames.indexOf(flush), 1)
      },
      onEvent: (e) => events.push(e),
    })
    await Promise.resolve()
    expect(frames).toHaveLength(1)
    frames.shift()?.()
    expect(events.map((e) => [e.phase, e.label])).toEqual([
      ['download', 'Loading ffmpeg'],
      ['start', 'Starting ffmpeg'],
    ])
    finishDownload()
    await joining
    expect(events.at(-1)?.phase).toBe('done')
    expect(frames).toHaveLength(0)
  })

  it('fails and terminates ffmpeg after 120 s without a log line or progress event', async () => {
    vi.useFakeTimers()
    try {
      const ffmpeg = new FakeFFmpeg((args, fake) => {
        if (args.at(-1) !== 'seg1.mp4') return 0
        setTimeout(() => fake.emitLog('frame=  120'), 100_000)
        return new Promise<number>(() => undefined)
      })
      const joining = run({ ffmpeg, files, segments, mode: 'fast' })
      const outcome = joining.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(219_999)
      expect(ffmpeg.methods()).not.toContain('terminate')
      await vi.advanceTimersByTimeAsync(1)
      const error = await outcome
      expect(error).toBeInstanceOf(JoinError)
      expect((error as JoinError).message).toBe(STALLED_MESSAGE)
      // A dead worker is not fixed by re-encoding, even though it died in a Fast cut.
      expect((error as JoinError).retryable).toBe(false)
      expect((error as JoinError).log).toEqual(['frame=  120'])
      expect(ffmpeg.methods()).toContain('terminate')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['ffmpeg did not start', 'The download stalled'])(
    'reports "%s" in a Fast join as a join error that Precise would not fix',
    async (message) => {
      const ffmpeg = new FakeFFmpeg()
      ffmpeg.downloading = Promise.reject(new Error(message))
      const error = await run({ ffmpeg, files, segments, mode: 'fast' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(JoinError)
      expect((error as JoinError).message).toBe(message)
      expect((error as JoinError).retryable).toBe(false)
      expect(ffmpeg.methods()).not.toContain('mount')
    },
  )

  it('does not offer Precise again for a Precise cut that fails', async () => {
    const ffmpeg = new FakeFFmpeg((args) => (args.at(-1) === 'seg0.mp4' ? 1 : 0))
    const error = await run({ ffmpeg, files, segments, mode: 'precise' }).catch((e: unknown) => e)
    expect((error as JoinError).retryable).toBe(false)
  })

  it('emits nothing for a download chunk or log line that arrives after the join failed', async () => {
    const ffmpeg = new FakeFFmpeg()
    ffmpeg.download = [{ received: 1e6, total: 32.8e6 }]
    ffmpeg.downloading = Promise.reject(new Error('The download stalled'))
    const events: JoinEvent[] = []
    const error = await run({
      ffmpeg,
      files,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JoinError)
    const before = events.length
    // A sibling reader that was still streaming reports one more chunk.
    ffmpeg.downloadListeners[0]?.({ received: 2e6, total: 32.8e6 })
    ffmpeg.emitLog('late line')
    expect(events).toHaveLength(before)
    expect(events.at(-1)?.label).toBe('Downloading ffmpeg · 1.0 of 32.8 MB')
  })

  it('does not start when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const ffmpeg = new FakeFFmpeg()
    await expect(
      run({ ffmpeg, files, segments, mode: 'fast', signal: controller.signal }),
    ).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.calls).toEqual([])
  })

  it('refuses an empty selection', async () => {
    await expect(
      run({ ffmpeg: new FakeFFmpeg(), files, segments: [], mode: 'fast' }),
    ).rejects.toBeInstanceOf(JoinError)
  })
})

/** Reports `chunks` (bytes copied of the total) and resolves to `result`, or to staged copies. */
class FakeStager implements Stager {
  calls = 0
  signals: (AbortSignal | undefined)[] = []
  private readonly chunks: [number, number][]
  private readonly result: 'copies' | null
  private readonly copying: Promise<void>
  constructor(
    chunks: [number, number][],
    result: 'copies' | null = 'copies',
    copying: Promise<void> = Promise.resolve(),
  ) {
    this.chunks = chunks
    this.result = result
    this.copying = copying
  }
  async stage(sources: readonly File[], onProgress: StageListener, signal?: AbortSignal) {
    this.calls++
    this.signals.push(signal)
    for (const [copied, total] of this.chunks) onProgress(copied, total)
    await this.copying
    signal?.throwIfAborted()
    if (this.result === null) return null
    return sources.map((source, i) => new File([source], `staged${i}.mov`))
  }
}

describe('runJoin staging', () => {
  it('stages after the core loads, mounts the copies and cuts from them', async () => {
    const ffmpeg = new FakeFFmpeg()
    const stager = new FakeStager([
      [0, 2e9],
      [1e9, 2e9],
      [2e9, 2e9],
    ])
    const events: JoinEvent[] = []
    await run({ ffmpeg, stager, files, segments, mode: 'fast', onEvent: (e) => events.push(e) })

    expect(ffmpeg.calls[1]).toEqual({ method: 'mount', args: ['staged0.mov', '/in0'] })
    expect(ffmpeg.execArgs()[0]).toEqual(segmentArgs('fast', first, 0, '/in0/staged0.mov'))
    const staging = events.filter((e) => e.phase === 'stage')
    expect(staging.map((e) => e.label)).toEqual([
      'Preparing video · 0.0 of 2.0 GB',
      'Preparing video · 1.0 of 2.0 GB',
      'Preparing video · 2.0 of 2.0 GB',
    ])
    expect(events.indexOf(staging[0] as JoinEvent)).toBeGreaterThan(
      events.findIndex((e) => e.phase === 'download'),
    )
    expect(events.every((e) => !e.uncached)).toBe(true)
    // 2 GB at 500 MB/s is 4 s next to 2 s of cutting at 20 and 1 s of concat at 40.
    expect(staging.at(-1)?.progress).toBeCloseTo(4 / (4 + 2 + 1), 3)
  })

  it('has no stage phase when every copy is already staged', async () => {
    const events: JoinEvent[] = []
    await run({
      ffmpeg: new FakeFFmpeg(),
      stager: new FakeStager([]),
      files,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    })
    expect(events.some((e) => e.phase === 'stage')).toBe(false)
  })

  it('mounts the originals and says so when the browser cannot stage', async () => {
    const ffmpeg = new FakeFFmpeg()
    const events: JoinEvent[] = []
    const blob = await run({
      ffmpeg,
      stager: new FakeStager([], null),
      files,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    })
    expect(blob.size).toBe(4)
    expect(ffmpeg.calls[1]).toEqual({ method: 'mount', args: ['game.mp4', '/in0'] })
    expect(events.at(-1)).toMatchObject({ phase: 'done', uncached: true })
  })

  it('stops during staging without mounting anything', async () => {
    let finish = () => undefined as void
    const copying = new Promise<void>((resolve) => {
      finish = resolve
    })
    const stager = new FakeStager([[0, 1e9]], 'copies', copying)
    const ffmpeg = new FakeFFmpeg()
    const controller = new AbortController()
    const joining = run({
      ffmpeg,
      stager,
      files,
      segments,
      mode: 'fast',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(stager.calls).toBe(1))
    controller.abort()
    finish()
    await expect(joining).rejects.toBeInstanceOf(JoinCancelled)
    expect(stager.signals).toEqual([controller.signal])
    expect(ffmpeg.methods()).not.toContain('mount')
  })
})

describe('nextFrame', () => {
  it('uses a 250 ms timer while the tab is hidden, where animation frames do not run', () => {
    vi.useFakeTimers()
    const frame = vi.fn()
    vi.stubGlobal('document', { hidden: true })
    vi.stubGlobal('requestAnimationFrame', frame)
    try {
      const flush = vi.fn()
      nextFrame(flush)
      vi.advanceTimersByTime(249)
      expect(flush).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(flush).toHaveBeenCalledOnce()
      expect(frame).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { segmentArgs, type Segment } from './plan'
import {
  FALLBACK_REASON,
  JoinCancelled,
  JoinError,
  runJoin,
  type FFmpegLike,
  type JoinEvent,
  type LogListener,
  type ProgressListener,
} from './runner'

type Call = { method: string; args: unknown[] }
type ExecHandler = (args: string[], fake: FakeFFmpeg) => number | Promise<number>

class FakeFFmpeg implements FFmpegLike {
  calls: Call[] = []
  files = new Map<string, string>()
  logListeners = new Set<LogListener>()
  progressListeners = new Set<ProgressListener>()
  loaded = false
  loads = 0
  private pending: ((reason: Error) => void)[] = []

  private handler: ExecHandler

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

  async load() {
    this.record('load')
    if (!this.loaded) this.loads++
    this.loaded = true
  }
  async mount(file: File, mountPoint: string) {
    this.record('mount', file.name, mountPoint)
  }
  async unmount(mountPoint: string) {
    this.record('unmount', mountPoint)
  }
  exec(args: string[]): Promise<number> {
    this.record('exec', args)
    return new Promise((resolve, reject) => {
      this.pending.push(reject)
      Promise.resolve(this.handler(args, this)).then((code) => {
        const output = args[args.length - 1]
        if (code === 0) this.files.set(output, 'data')
        resolve(code)
      }, reject)
    })
  }
  async readFile(path: string) {
    this.record('readFile', path)
    if (!this.files.has(path)) throw new Error(`missing ${path}`)
    return new Uint8Array([1, 2, 3, 4])
  }
  async writeFile(path: string, data: string) {
    this.record('writeFile', path, data)
    this.files.set(path, data)
  }
  async deleteFile(path: string) {
    this.record('deleteFile', path)
    this.files.delete(path)
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

const file = new File(['x'], 'game.mp4', { type: 'video/mp4' })
const segments: Segment[] = [
  { start: 0, end: 10 },
  { start: 20, end: 50 },
]
const isConcat = (args: string[]) => args.includes('concat')

describe('runJoin', () => {
  it('mounts the source, cuts each segment, concatenates and returns the output', async () => {
    const ffmpeg = new FakeFFmpeg()
    const blob = await runJoin({ ffmpeg, file, segments, mode: 'fast' })

    expect(blob.size).toBe(4)
    expect(blob.type).toBe('video/mp4')
    expect(ffmpeg.calls[0].method).toBe('load')
    expect(ffmpeg.calls[1]).toEqual({ method: 'mount', args: ['game.mp4', '/in'] })
    expect(ffmpeg.execArgs()).toEqual([
      segmentArgs('fast', segments[0], 0, '/in/game.mp4'),
      segmentArgs('fast', segments[1], 1, '/in/game.mp4'),
      ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'],
    ])
    expect(ffmpeg.calls).toContainEqual({
      method: 'writeFile',
      args: ['list.txt', "file 'seg0.mp4'\nfile 'seg1.mp4'\n"],
    })
    expect(ffmpeg.methods().at(-1)).toBe('unmount')
  })

  it('leaves nothing behind in MEMFS', async () => {
    const ffmpeg = new FakeFFmpeg()
    await runJoin({ ffmpeg, file, segments, mode: 'precise' })
    expect([...ffmpeg.files.keys()]).toEqual([])
  })

  it('deletes the segment files after concat, before reading the output', async () => {
    const ffmpeg = new FakeFFmpeg()
    await runJoin({ ffmpeg, file, segments, mode: 'precise' })
    const methods = ffmpeg.calls.map((c) => `${c.method} ${c.args[0] ?? ''}`)
    const concat = methods.findIndex((m) => m.startsWith('exec -f,concat'))
    const read = methods.indexOf('readFile out.mp4')
    for (const path of ['seg0.mp4', 'seg1.mp4', 'list.txt']) {
      const deleted = methods.indexOf(`deleteFile ${path}`)
      expect(deleted).toBeGreaterThan(concat)
      expect(deleted).toBeLessThan(read)
    }
    expect(methods.indexOf('deleteFile out.mp4')).toBeGreaterThan(read)
  })

  it('emits progress weighted by segment duration', async () => {
    const ffmpeg = new FakeFFmpeg((args, fake) => {
      if (!isConcat(args)) fake.emitProgress(args.at(-1) === 'seg0.mp4' ? 5_000_000 : 15_000_000)
      return 0
    })
    const events: JoinEvent[] = []
    await runJoin({ ffmpeg, file, segments, mode: 'fast', onEvent: (e) => events.push(e) })

    const summary = events
      .filter((e) => !e.log)
      .map((e) => [e.phase, e.segmentIndex, Number(e.progress.toFixed(3))])
    expect(summary).toEqual([
      ['segment', 0, 0],
      ['segment', 0, 0.125],
      ['segment', 1, 0.25],
      ['segment', 1, 0.625],
      ['concat', 1, 1],
      ['done', 1, 1],
    ])
  })

  it('forwards log lines and keeps them for errors', async () => {
    const ffmpeg = new FakeFFmpeg((_, fake) => {
      fake.emitLog('Invalid data found when processing input')
      return 1
    })
    const logs: string[] = []
    const error = await runJoin({
      ffmpeg,
      file,
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
    const error = await runJoin({ ffmpeg, file, segments, mode: 'fast' }).catch((e: unknown) => e)
    expect((error as JoinError).mode).toBe('fast')
    expect(ffmpeg.execArgs()).toHaveLength(2)
    expect(ffmpeg.files.size).toBe(0)
  })

  it('falls back to precise when the fast concat fails', async () => {
    let concats = 0
    const ffmpeg = new FakeFFmpeg((args) => (isConcat(args) && concats++ === 0 ? 1 : 0))
    const events: JoinEvent[] = []
    const blob = await runJoin({
      ffmpeg,
      file,
      segments,
      mode: 'fast',
      onEvent: (e) => events.push(e),
    })

    expect(blob.size).toBe(4)
    const execs = ffmpeg.execArgs()
    expect(execs).toHaveLength(6)
    expect(execs[3]).toEqual(segmentArgs('precise', segments[0], 0, '/in/game.mp4'))
    expect(events.find((e) => e.phase === 'fallback')).toMatchObject({
      mode: 'precise',
      log: FALLBACK_REASON,
    })
    expect(events.at(-1)).toMatchObject({ phase: 'done', mode: 'precise' })
    expect(ffmpeg.files.size).toBe(0)
  })

  it('fails when the precise concat fails', async () => {
    const ffmpeg = new FakeFFmpeg((args) => (isConcat(args) ? 1 : 0))
    const error = await runJoin({ ffmpeg, file, segments, mode: 'precise' }).catch((e) => e)
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
    const first = runJoin({ ffmpeg, file, segments, mode: 'precise', signal: controller.signal })
    await expect(first).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.methods()).toContain('terminate')
    expect(ffmpeg.methods()).not.toContain('unmount')
    expect(ffmpeg.progressListeners.size).toBe(0)
    expect(ffmpeg.logListeners.size).toBe(0)

    hang = false
    const blob = await runJoin({ ffmpeg, file, segments, mode: 'precise' })
    expect(blob.size).toBe(4)
    expect(ffmpeg.loads).toBe(2)
  })

  it('does not start when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const ffmpeg = new FakeFFmpeg()
    await expect(
      runJoin({ ffmpeg, file, segments, mode: 'fast', signal: controller.signal }),
    ).rejects.toBeInstanceOf(JoinCancelled)
    expect(ffmpeg.calls).toEqual([])
  })

  it('refuses an empty selection', async () => {
    await expect(
      runJoin({ ffmpeg: new FakeFFmpeg(), file, segments: [], mode: 'fast' }),
    ).rejects.toBeInstanceOf(JoinError)
  })
})

import {
  CONCAT_LIST,
  concatArgs,
  concatListContent,
  segmentArgs,
  segmentFileName,
  segmentRatio,
  weightedProgress,
  type JoinMode,
  type Segment,
} from './plan'

export type LogListener = (event: { type: string; message: string }) => void
export type ProgressListener = (event: { progress: number; time: number }) => void

/** The slice of `@ffmpeg/ffmpeg` the runner needs, so tests can swap in a fake. */
export interface FFmpegLike {
  /** Loads the core if it is not loaded already (again after `terminate`). */
  load(): Promise<void>
  /** Mounts `file` read-only with WORKERFS at `mountPoint`, readable as `<mountPoint>/<name>`. */
  mount(file: File, mountPoint: string): Promise<void>
  unmount(mountPoint: string): Promise<void>
  exec(args: string[]): Promise<number>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: string): Promise<void>
  deleteFile(path: string): Promise<void>
  on(event: 'log', listener: LogListener): void
  on(event: 'progress', listener: ProgressListener): void
  off(event: 'log', listener: LogListener): void
  off(event: 'progress', listener: ProgressListener): void
  /** Kills the worker and rejects every pending call. */
  terminate(): void
}

export type JoinPhase = 'loading' | 'segment' | 'concat' | 'fallback' | 'done'

export type JoinEvent = {
  phase: JoinPhase
  mode: JoinMode
  segmentIndex: number
  /** Overall 0..1, segments weighted by duration. */
  progress: number
  log?: string
}

export type JoinOptions = {
  file: File
  segments: readonly Segment[]
  mode: JoinMode
  onEvent?: (event: JoinEvent) => void
  signal?: AbortSignal
}

export const MOUNT_POINT = '/in'
export const OUTPUT = 'out.mp4'
const LOG_LIMIT = 200

export const FALLBACK_REASON =
  'Fast join could not combine the segments, usually because their codec settings differ. Re-encoding with Precise instead.'

export class JoinError extends Error {
  readonly mode: JoinMode
  readonly log: string[]

  constructor(message: string, mode: JoinMode, log: string[]) {
    super(message)
    this.name = 'JoinError'
    this.mode = mode
    this.log = log
  }
}

export class JoinCancelled extends Error {
  constructor() {
    super('Join stopped')
    this.name = 'JoinCancelled'
  }
}

/**
 * Renders `segments` of `file` into one mp4. The source is mounted, never copied into wasm memory.
 * Aborting `signal` terminates ffmpeg; the next run reloads the core.
 */
export async function runJoin({
  file,
  segments,
  mode,
  onEvent,
  signal,
  ffmpeg,
}: JoinOptions & { ffmpeg: FFmpegLike }): Promise<Blob> {
  if (segments.length === 0) throw new JoinError('There are no clips to join.', mode, [])
  if (signal?.aborted) throw new JoinCancelled()

  const log: string[] = []
  let current: JoinEvent = { phase: 'loading', mode, segmentIndex: 0, progress: 0 }
  const emit = (patch: Partial<JoinEvent>) => {
    current = { ...current, ...patch }
    onEvent?.(current)
  }

  const onLog: LogListener = ({ message }) => {
    log.push(message)
    if (log.length > LOG_LIMIT) log.shift()
    onEvent?.({ ...current, log: message })
  }
  const onProgress: ProgressListener = ({ time }) => {
    if (current.phase !== 'segment') return
    const seg = segments[current.segmentIndex]
    emit({ progress: weightedProgress(segments, current.segmentIndex, segmentRatio(time, seg)) })
  }
  const onAbort = () => ffmpeg.terminate()

  signal?.addEventListener('abort', onAbort)
  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)
  let mounted = false

  const fail = (message: string, failedMode: JoinMode) =>
    new JoinError(message, failedMode, [...log])

  const removeAll = async (paths: string[]) => {
    for (const path of paths) await ffmpeg.deleteFile(path).catch(() => undefined)
  }
  const segmentFiles = segments.map((_, i) => segmentFileName(i))

  const render = async (renderMode: JoinMode): Promise<boolean> => {
    const input = `${MOUNT_POINT}/${file.name}`
    for (let i = 0; i < segments.length; i++) {
      emit({
        phase: 'segment',
        mode: renderMode,
        segmentIndex: i,
        progress: weightedProgress(segments, i, 0),
      })
      const code = await ffmpeg.exec(segmentArgs(renderMode, segments[i], i, input))
      if (code !== 0) {
        await removeAll(segmentFiles.slice(0, i + 1))
        throw fail(`ffmpeg could not cut segment ${i + 1} (exit code ${code}).`, renderMode)
      }
    }
    await ffmpeg.writeFile(CONCAT_LIST, concatListContent(segments.length))
    emit({ phase: 'concat', segmentIndex: segments.length - 1, progress: 1 })
    const code = await ffmpeg.exec(concatArgs(OUTPUT))
    await removeAll([...segmentFiles, CONCAT_LIST])
    if (code === 0) return true
    await removeAll([OUTPUT])
    if (renderMode === 'precise') {
      throw fail(`ffmpeg could not combine the segments (exit code ${code}).`, renderMode)
    }
    return false
  }

  try {
    await ffmpeg.load()
    await ffmpeg.mount(file, MOUNT_POINT)
    mounted = true

    if (!(await render(mode))) {
      emit({
        phase: 'fallback',
        mode: 'precise',
        segmentIndex: 0,
        progress: 0,
        log: FALLBACK_REASON,
      })
      await render('precise')
    }

    const data = await ffmpeg.readFile(OUTPUT)
    await removeAll([OUTPUT])
    emit({ phase: 'done', progress: 1 })
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
  } catch (error) {
    if (signal?.aborted) throw new JoinCancelled()
    if (error instanceof JoinError) throw error
    throw fail(error instanceof Error ? error.message : String(error), current.mode)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
    if (mounted && !signal?.aborted) await ffmpeg.unmount(MOUNT_POINT).catch(() => undefined)
  }
}

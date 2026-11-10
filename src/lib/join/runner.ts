import {
  CONCAT_LIST,
  concatArgs,
  concatListContent,
  inputPath,
  mountPoint,
  segmentArgs,
  segmentFileName,
  segmentRatio,
  totalDuration,
  type JoinMode,
  type Segment,
} from './plan'
import type { KeyValueStore } from '../persistence'
import { FALLBACK_LABEL, JoinProgress, loadRates, saveRates, type Rates } from './progress'

export type LogListener = (event: { type: string; message: string }) => void
export type ProgressListener = (event: { progress: number; time: number }) => void
/** Core download so far; `total` is null when the server sends no Content-Length. */
export type DownloadProgress = { received: number; total: number | null }
export type DownloadListener = (progress: DownloadProgress) => void

/** The slice of `@ffmpeg/ffmpeg` the runner needs, so tests can swap in a fake. */
export interface FFmpegLike {
  /**
   * Loads the core if it is not loaded already (again after `terminate`), downloading it first
   * when this page has not yet; `onProgress` hears about every downloaded chunk.
   */
  load(onProgress?: DownloadListener): Promise<void>
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

export type JoinPhase = 'download' | 'cut' | 'concat' | 'save' | 'fallback' | 'done'

export type JoinEvent = {
  phase: JoinPhase
  mode: JoinMode
  segmentIndex: number
  /** Overall 0..1 from the progress model: never lower than before except on a fallback. */
  progress: number
  /** Smoothed seconds left, or null while there is too little to measure. */
  remainingSeconds: number | null
  /** The phase label shown above the bar. */
  label: string
  log?: string
}

export type JoinOptions = {
  /** The sources in timeline order; `Segment.sourceIndex` points into this list. */
  files: readonly File[]
  segments: readonly Segment[]
  mode: JoinMode
  /** Shown in the final label, "Saved <name>". */
  outputName?: string
  /** Estimated output size: the work of the save phase. */
  outputBytes?: number
  /** Where learned rates are read from and written to (`localStorage` in the app). */
  store?: KeyValueStore | null
  /** Starting rates; defaults to the stored ones. */
  rates?: Rates
  now?: () => number
  onEvent?: (event: JoinEvent) => void
  signal?: AbortSignal
}

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
 * Renders `segments` into one mp4. Each source is mounted at `/in<i>`, never copied into wasm
 * memory. Aborting `signal` terminates ffmpeg; the next run reloads the core.
 */
export async function runJoin({
  files,
  segments,
  mode,
  outputName = OUTPUT,
  outputBytes = 0,
  store = null,
  rates,
  now = () => performance.now(),
  onEvent,
  signal,
  ffmpeg,
}: JoinOptions & { ffmpeg: FFmpegLike }): Promise<Blob> {
  if (segments.length === 0) throw new JoinError('There are no clips to join.', mode, [])
  if (signal?.aborted) throw new JoinCancelled()

  const log: string[] = []
  const model = new JoinProgress({
    segments,
    mode,
    outputBytes,
    rates: rates ?? loadRates(store),
    startedAt: now(),
    onLearn: (learned) => saveRates(store, learned),
  })
  const view = () => {
    const { progress, remainingSeconds, label } = model.view()
    return { progress, remainingSeconds, label }
  }
  let current: JoinEvent = { phase: 'download', mode, segmentIndex: 0, ...view() }
  const emit = (patch: Partial<JoinEvent>) => {
    current = { ...current, ...view(), ...patch }
    onEvent?.(current)
  }

  const onLog: LogListener = ({ message }) => {
    log.push(message)
    if (log.length > LOG_LIMIT) log.shift()
    onEvent?.({ ...current, log: message })
  }
  const outputSeconds = totalDuration(segments)
  const onProgress: ProgressListener = ({ time }) => {
    if (current.phase === 'cut') {
      const index = current.segmentIndex
      model.cut(index, segmentRatio(time, segments[index]), now())
    } else if (current.phase === 'concat') {
      model.concat(segmentRatio(time, { start: 0, end: outputSeconds }), now())
    } else return
    emit({})
  }
  const onAbort = () => ffmpeg.terminate()

  signal?.addEventListener('abort', onAbort)
  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)
  const mounted: string[] = []

  const fail = (message: string, failedMode: JoinMode) =>
    new JoinError(message, failedMode, [...log])

  const removeAll = async (paths: string[]) => {
    for (const path of paths) await ffmpeg.deleteFile(path).catch(() => undefined)
  }
  const segmentFiles = segments.map((_, i) => segmentFileName(i))

  const render = async (renderMode: JoinMode): Promise<boolean> => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const file = files[seg.sourceIndex]
      if (!file) {
        await removeAll(segmentFiles.slice(0, i))
        throw fail(`Segment ${i + 1} has no source video.`, renderMode)
      }
      model.cut(i, 0, now())
      emit({ phase: 'cut', mode: renderMode, segmentIndex: i })
      const input = inputPath(seg.sourceIndex, file.name)
      const code = await ffmpeg.exec(segmentArgs(renderMode, seg, i, input))
      if (code !== 0) {
        await removeAll(segmentFiles.slice(0, i + 1))
        throw fail(`ffmpeg could not cut segment ${i + 1} (exit code ${code}).`, renderMode)
      }
    }
    await ffmpeg.writeFile(CONCAT_LIST, concatListContent(segments.length))
    model.concat(0, now())
    emit({ phase: 'concat', segmentIndex: segments.length - 1 })
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
    onEvent?.(current)
    await ffmpeg.load(({ received, total }) => {
      model.download(received, total, now())
      emit({})
    })
    for (let i = 0; i < files.length; i++) {
      await ffmpeg.mount(files[i], mountPoint(i))
      mounted.push(mountPoint(i))
    }

    if (!(await render(mode))) {
      model.fallback(now())
      emit({
        phase: 'fallback',
        mode: 'precise',
        segmentIndex: 0,
        label: FALLBACK_LABEL,
        log: FALLBACK_REASON,
      })
      await render('precise')
    }

    model.save(now())
    emit({ phase: 'save' })
    const data = await ffmpeg.readFile(OUTPUT)
    await removeAll([OUTPUT])
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
    model.finish(outputName, now())
    emit({ phase: 'done' })
    return blob
  } catch (error) {
    if (signal?.aborted) throw new JoinCancelled()
    if (error instanceof JoinError) throw error
    throw fail(error instanceof Error ? error.message : String(error), current.mode)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
    if (!signal?.aborted) {
      for (const point of mounted) await ffmpeg.unmount(point).catch(() => undefined)
    }
  }
}

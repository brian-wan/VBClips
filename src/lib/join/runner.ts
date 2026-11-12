import {
  CONCAT_LIST,
  PROBE_FILE,
  concatArgs,
  concatDurations,
  concatListContent,
  inputPath,
  mountPoint,
  parseProbe,
  probeArgs,
  segmentArgs,
  segmentFileName,
  segmentRatio,
  totalDuration,
  type JoinMode,
  type Segment,
  type SegmentTiming,
} from './plan'
import type { KeyValueStore } from '../persistence'
import { FALLBACK_LABEL, JoinProgress, loadRates, saveRates, type Rates } from './progress'

/** Runs `flush` later and returns a function that cancels it. */
export type Scheduler = (flush: () => void) => () => void

/** How often events are delivered while the tab is hidden, where animation frames do not run. */
const HIDDEN_FLUSH_MS = 250

/**
 * One flush per animation frame in a visible page; a 250 ms timer in a hidden tab, so a join in
 * the background still shows where it got to when the tab returns; a 16 ms timer elsewhere.
 */
export const nextFrame: Scheduler = (flush) => {
  const page = typeof document !== 'undefined'
  if (page && !document.hidden && typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(flush)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(flush, page ? HIDDEN_FLUSH_MS : 16)
  return () => clearTimeout(id)
}

/** How often the estimate is refreshed while the core starts and reports nothing. */
const START_TICK_MS = 250
/** Silence from ffmpeg this long while it cuts, combines or saves means the worker is gone. */
const STALL_MS = 120_000

export type LogListener = (event: { type: string; message: string }) => void
export type ProgressListener = (event: { progress: number; time: number }) => void
/** Core download so far; `total` is null when the server sends no Content-Length. */
export type DownloadProgress = { received: number; total: number | null }
export type DownloadListener = (progress: DownloadProgress) => void

/** The slice of `@ffmpeg/ffmpeg` the runner needs, so tests can swap in a fake. */
export interface FFmpegLike {
  /**
   * Loads the core if it is not loaded already (again after `terminate`), downloading it first
   * when this page has not yet; `onProgress` hears about every downloaded chunk and ends with a
   * report whose total equals the bytes received. Aborting `signal` stops the download.
   */
  load(onProgress?: DownloadListener, signal?: AbortSignal): Promise<void>
  /** Mounts `file` read-only with WORKERFS at `mountPoint`, readable as `<mountPoint>/<name>`. */
  mount(file: File, mountPoint: string): Promise<void>
  unmount(mountPoint: string): Promise<void>
  exec(args: string[]): Promise<number>
  /** Runs the core's ffprobe. Core 0.12.10 resolves to -1 even when the probe worked. */
  ffprobe(args: string[]): Promise<number>
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

/** Bytes copied of the bytes to copy, across every source being staged. */
export type StageListener = (copied: number, total: number) => void

/** Copies the sources somewhere ffmpeg reads quickly before they are mounted. */
export interface Stager {
  /**
   * Resolves to the copies in `files` order, reusing copies made by earlier joins, or to null
   * when this browser cannot stage (no private file system, no sync access handles, too little
   * quota), so the originals are mounted instead. `onProgress` is called only when something
   * needs copying. Aborting `signal` stops the copy, removes the partial file and rejects.
   */
  stage(
    files: readonly File[],
    onProgress: StageListener,
    signal?: AbortSignal,
  ): Promise<readonly File[] | null>
}

export type JoinPhase =
  'download' | 'start' | 'stage' | 'cut' | 'concat' | 'save' | 'fallback' | 'done'

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
  /** Staging was not possible, so the originals are mounted and reads may be slow. */
  uncached: boolean
  log?: string
}

export type JoinOptions = {
  /** The sources in timeline order; `Segment.sourceIndex` points into this list. */
  files: readonly File[]
  /** Copies the sources before they are mounted; without one the originals are mounted. */
  stager?: Stager | null
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
  /** Coalesces progress events; defaults to one per animation frame. */
  schedule?: Scheduler
  onEvent?: (event: JoinEvent) => void
  signal?: AbortSignal
}

const OUTPUT = 'out.mp4'
const LOG_LIMIT = 200

export const STALLED_MESSAGE =
  'ffmpeg stopped responding, usually because the browser ran out of memory. Try fewer clips or Precise mode.'

export const FALLBACK_REASON =
  'Fast join could not combine the segments, usually because their codec settings differ. Re-encoding with Precise instead.'

export class JoinError extends Error {
  readonly mode: JoinMode
  readonly log: string[]
  /** The failure was inside a Fast cut, so trying Precise may help. */
  readonly retryable: boolean

  constructor(message: string, mode: JoinMode, log: string[], retryable = false) {
    super(message)
    this.name = 'JoinError'
    this.mode = mode
    this.log = log
    this.retryable = retryable
  }
}

export class JoinCancelled extends Error {
  constructor() {
    super('Join stopped')
    this.name = 'JoinCancelled'
  }
}

/**
 * Renders `segments` into one mp4. Each source is staged by `stager` when there is one, then
 * mounted at `/in<i>`, never copied into wasm memory. Aborting `signal` terminates ffmpeg; the
 * next run reloads the core.
 */
export async function runJoin({
  files,
  stager = null,
  segments,
  mode,
  outputName = OUTPUT,
  outputBytes = 0,
  store = null,
  rates,
  now = () => performance.now(),
  schedule = nextFrame,
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
  /** The model's view for one delivered event; the phase is the model's stage. */
  const view = () => {
    const { stage, progress, remainingSeconds, label } = model.snapshot()
    return { phase: stage, progress, remainingSeconds, label }
  }
  let current: JoinEvent = { mode, segmentIndex: 0, uncached: false, ...view() }
  let pending = false
  let cancelFlush = () => undefined as void
  const cancelPending = () => {
    if (pending) cancelFlush()
    pending = false
  }
  /** Set once runJoin settles: late download chunks or log lines must not revive the dialog. */
  let finished = false
  const deliver = () => {
    if (finished) return
    cancelPending()
    current = { ...current, ...view() }
    onEvent?.(current)
  }
  type Patch = Partial<Pick<JoinEvent, 'mode' | 'segmentIndex' | 'uncached'>>
  /** Records the change and delivers it with the next frame, with any others before then. */
  const emit = (patch: Patch = {}) => {
    if (finished) return
    current = { ...current, ...patch }
    if (pending) return
    pending = true
    cancelFlush = schedule(() => {
      pending = false
      deliver()
    })
  }
  /** Delivers at once: the first event and done. */
  const emitNow = () => deliver()

  let startTicker: ReturnType<typeof setInterval> | undefined
  const stopTicking = () => {
    clearInterval(startTicker)
    startTicker = undefined
  }
  const onDownload = ({ received, total }: DownloadProgress) => {
    model.download(received, total, now())
    if (total === null || received < total) {
      stopTicking()
      emit()
      return
    }
    model.start(now())
    emit()
    startTicker ??= setInterval(() => {
      model.tick(now())
      emit()
    }, START_TICK_MS)
  }

  // Armed from the first cut until the output is read: any log line or progress event resets it.
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let stalled = false
  const disarm = () => {
    clearTimeout(watchdog)
    watchdog = undefined
  }
  const arm = () => {
    disarm()
    watchdog = setTimeout(() => {
      stalled = true
      ffmpeg.terminate()
    }, STALL_MS)
  }
  const heardFromFFmpeg = () => {
    if (watchdog !== undefined) arm()
  }

  const onLog: LogListener = ({ message }) => {
    heardFromFFmpeg()
    log.push(message)
    if (log.length > LOG_LIMIT) log.shift()
    if (!finished) onEvent?.({ ...current, log: message })
  }
  const outputSeconds = totalDuration(segments)
  const onProgress: ProgressListener = ({ time }) => {
    heardFromFFmpeg()
    const { stage } = model.view()
    const segment = segments[current.segmentIndex]
    if (stage === 'cut' && segment) {
      model.cut(current.segmentIndex, segmentRatio(time, segment), now())
    } else if (stage === 'concat') {
      model.concat(segmentRatio(time, { start: 0, end: outputSeconds }), now())
    } else return
    emit()
  }
  const onAbort = () => ffmpeg.terminate()

  signal?.addEventListener('abort', onAbort)
  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)
  const mounted: string[] = []

  const fail = (message: string, failedMode: JoinMode, retryable = false) =>
    new JoinError(message, failedMode, [...log], retryable)
  /** Only a failure inside a Fast cut or concat is worth retrying with Precise. */
  const insideFastRender = () => {
    const { stage } = model.view()
    return current.mode === 'fast' && (stage === 'cut' || stage === 'concat')
  }

  const removeAll = async (paths: string[]) => {
    for (const path of paths) await ffmpeg.deleteFile(path).catch(() => undefined)
  }
  const segmentFiles = segments.map((_, i) => segmentFileName(i))

  /**
   * The written segment's timing, for its line in the concat list. A probe that fails costs
   * only that line's `duration`, never the join; a terminated core still fails it. The core's
   * ffprobe reports -1 whether or not it worked, so the JSON it writes decides.
   */
  const probeSegment = async (index: number): Promise<SegmentTiming | null> => {
    const removeProbe = () => ffmpeg.deleteFile(PROBE_FILE).catch(() => undefined)
    try {
      await removeProbe()
      await ffmpeg.ffprobe(probeArgs(index))
      return parseProbe(new TextDecoder().decode(await ffmpeg.readFile(PROBE_FILE)))
    } catch (error) {
      if (signal?.aborted || stalled) throw error
      return null
    } finally {
      await removeProbe()
    }
  }

  /** What is mounted: the staged copies, or the originals when staging was not possible. */
  let inputs: readonly File[] = files
  const render = async (renderMode: JoinMode): Promise<boolean> => {
    const timings: (SegmentTiming | null)[] = []
    for (const [i, seg] of segments.entries()) {
      const file = inputs[seg.sourceIndex]
      if (!file) {
        await removeAll(segmentFiles.slice(0, i))
        throw fail(`Segment ${i + 1} has no source video.`, renderMode)
      }
      model.cut(i, 0, now())
      emit({ mode: renderMode, segmentIndex: i })
      const input = inputPath(seg.sourceIndex, file.name)
      const code = await ffmpeg.exec(segmentArgs(renderMode, seg, i, input))
      if (code !== 0) {
        await removeAll(segmentFiles.slice(0, i + 1))
        throw fail(
          `ffmpeg could not cut segment ${i + 1} (exit code ${code}).`,
          renderMode,
          renderMode === 'fast',
        )
      }
      timings.push(await probeSegment(i))
    }
    await ffmpeg.writeFile(CONCAT_LIST, concatListContent(concatDurations(timings)))
    model.concat(0, now())
    emit({ segmentIndex: segments.length - 1 })
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
    emitNow()
    await ffmpeg.load(onDownload, signal)
    stopTicking()
    // The download runs in the page, where terminate() cannot reach it.
    if (signal?.aborted) throw new JoinCancelled()
    if (stager) {
      const staged = await stager.stage(
        files,
        (copied, total) => {
          model.stage(copied, total, now())
          emit()
        },
        signal,
      )
      if (signal?.aborted) throw new JoinCancelled()
      if (staged?.length === files.length) inputs = staged
      else emit({ uncached: true })
    }
    for (const [i, file] of inputs.entries()) {
      await ffmpeg.mount(file, mountPoint(i))
      mounted.push(mountPoint(i))
    }

    arm()
    if (!(await render(mode))) {
      // The one event whose phase is set by hand. It carries the reason as a log line, which
      // later events must not repeat, so it is delivered without becoming the current event.
      model.fallback(now())
      cancelPending()
      current = { ...current, ...view(), mode: 'precise', segmentIndex: 0 }
      onEvent?.({ ...current, phase: 'fallback', label: FALLBACK_LABEL, log: FALLBACK_REASON })
      await render('precise')
    }

    model.save(now())
    emit()
    const data = await ffmpeg.readFile(OUTPUT)
    disarm()
    await removeAll([OUTPUT])
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
    model.finish(outputName, now())
    emitNow()
    return blob
  } catch (error) {
    if (signal?.aborted) throw new JoinCancelled()
    if (stalled) throw fail(STALLED_MESSAGE, current.mode)
    if (error instanceof JoinError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw fail(message, current.mode, insideFastRender())
  } finally {
    finished = true
    disarm()
    stopTicking()
    cancelPending()
    signal?.removeEventListener('abort', onAbort)
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
    if (!signal?.aborted && !stalled) {
      for (const point of mounted) await ffmpeg.unmount(point).catch(() => undefined)
    }
  }
}

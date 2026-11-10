import { groupBySource, mergeOverlaps, type Clip, type Span } from '../clips'

export type JoinMode = 'fast' | 'precise'
/** A stretch of one source to render; `sourceIndex` is the source's position in the timeline. */
export type Segment = Span & { sourceIndex: number }

/** The output is assembled in MEMFS, so anything bigger risks running the tab out of memory. */
export const MAX_OUTPUT_BYTES = 1.5e9
export const CONCAT_LIST = 'list.txt'

/** Media seconds processed per wall-clock second before a rate has been measured. */
export const DEFAULT_RATE: Record<JoinMode, number> = { fast: 20, precise: 0.15 }

/** ffmpeg.wasm reports `time` in microseconds of output written. */
const MICROSECONDS = 1_000_000

/** Segments in sequence order: overlaps merged within each source, sources in timeline order. */
export function planSegments(clips: readonly Clip[], sourceIds: readonly string[]): Segment[] {
  const groups = groupBySource(clips)
  return sourceIds.flatMap((id, sourceIndex) =>
    mergeOverlaps(groups.get(id) ?? [])
      .filter((seg) => seg.end > seg.start)
      .map((seg) => ({ sourceIndex, ...seg })),
  )
}

/** Where source `index` is mounted with WORKERFS. */
export function mountPoint(index: number): string {
  return `/in${index}`
}

export function inputPath(index: number, fileName: string): string {
  return `${mountPoint(index)}/${fileName}`
}

export function segmentFileName(index: number): string {
  return `seg${index}.mp4`
}

const timeArg = (seconds: number) => seconds.toFixed(3)

/**
 * The multi-thread core preallocates 32 pthread workers and cannot start more while ffmpeg is
 * running, so default thread counts (about one per core for the decoder and 1.5 per core for
 * libx264) deadlock on machines with many cores. Cap both for re-encodes.
 */
export const PRECISE_THREADS = '4'

export function segmentArgs(mode: JoinMode, seg: Span, index: number, input: string): string[] {
  const cut = ['-ss', timeArg(seg.start), '-to', timeArg(seg.end), '-i', input]
  if (mode === 'fast') {
    return [
      ...cut,
      ...['-c', 'copy', '-avoid_negative_ts', 'make_zero'],
      ...['-movflags', '+faststart', segmentFileName(index)],
    ]
  }
  return [
    ...['-threads', PRECISE_THREADS, ...cut],
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'],
    ...['-c:a', 'aac', '-b:a', '160k', '-threads', PRECISE_THREADS],
    ...['-movflags', '+faststart', segmentFileName(index)],
  ]
}

export function concatListContent(count: number): string {
  return Array.from({ length: count }, (_, i) => `file '${segmentFileName(i)}'\n`).join('')
}

export function concatArgs(output: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', CONCAT_LIST, '-c', 'copy', output]
}

export function outputFileName(videoName: string): string {
  const base = videoName.replace(/\.[^./\\]*$/, '') || 'video'
  return `${base}-highlights.mp4`
}

export function totalDuration(segments: readonly Span[]): number {
  return segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
}

export type SizedSource = { size: number; duration: number }

/** Output size with each segment at its own source's average bitrate. */
export function estimateOutputBytes(
  segments: readonly Segment[],
  sources: readonly SizedSource[],
): number {
  return segments.reduce((sum, seg) => {
    const source = sources[seg.sourceIndex]
    if (!source || !(source.duration > 0)) return sum
    return sum + (seg.end - seg.start) * (source.size / source.duration)
  }, 0)
}

/** Wall-clock seconds to render `segments` at `rate` media seconds per second. */
export function estimateSeconds(
  mode: JoinMode,
  segments: readonly Span[],
  rate: number = DEFAULT_RATE[mode],
): number {
  const effective = rate > 0 && Number.isFinite(rate) ? rate : DEFAULT_RATE[mode]
  return totalDuration(segments) / effective
}

export function formatEstimate(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`
}

/** Fraction of the current segment written, from an ffmpeg progress event's `time`. */
export function segmentRatio(time: number, seg: Span): number {
  const length = seg.end - seg.start
  if (!(length > 0) || !Number.isFinite(time)) return 0
  return Math.min(Math.max(time / MICROSECONDS / length, 0), 1)
}

/** Overall progress with each segment weighted by its duration. */
export function weightedProgress(segments: readonly Span[], index: number, ratio: number): number {
  const total = totalDuration(segments)
  if (total <= 0) return 0
  const done = totalDuration(segments.slice(0, Math.max(index, 0)))
  const current = segments[index]
  const partial = current ? (current.end - current.start) * Math.min(Math.max(ratio, 0), 1) : 0
  return Math.min((done + partial) / total, 1)
}

import { mergeOverlaps, type Clip } from '../clips'

export type JoinMode = 'fast' | 'precise'
export type Segment = { start: number; end: number }

/** The output is assembled in MEMFS, so anything bigger risks running the tab out of memory. */
export const MAX_OUTPUT_BYTES = 1.5e9
export const CONCAT_LIST = 'list.txt'

/** Media seconds processed per wall-clock second before a rate has been measured. */
export const DEFAULT_RATE: Record<JoinMode, number> = { fast: 20, precise: 0.15 }

/** ffmpeg.wasm reports `time` in microseconds of output written. */
const MICROSECONDS = 1_000_000

export function planSegments(clips: readonly Clip[]): Segment[] {
  return mergeOverlaps(clips).filter((seg) => seg.end > seg.start)
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

export function segmentArgs(mode: JoinMode, seg: Segment, index: number, input: string): string[] {
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

export function totalDuration(segments: readonly Segment[]): number {
  return segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
}

/** Output size at the source's average bitrate. */
export function estimateOutputBytes(
  segments: readonly Segment[],
  fileSize: number,
  duration: number,
): number {
  if (!(duration > 0)) return 0
  return totalDuration(segments) * (fileSize / duration)
}

/** Wall-clock seconds to render `segments` at `rate` media seconds per second. */
export function estimateSeconds(
  mode: JoinMode,
  segments: readonly Segment[],
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
export function segmentRatio(time: number, seg: Segment): number {
  const length = seg.end - seg.start
  if (!(length > 0) || !Number.isFinite(time)) return 0
  return Math.min(Math.max(time / MICROSECONDS / length, 0), 1)
}

/** Overall progress with each segment weighted by its duration. */
export function weightedProgress(
  segments: readonly Segment[],
  index: number,
  ratio: number,
): number {
  const total = totalDuration(segments)
  if (total <= 0) return 0
  const done = totalDuration(segments.slice(0, Math.max(index, 0)))
  const current = segments[index]
  const partial = current ? (current.end - current.start) * Math.min(Math.max(ratio, 0), 1) : 0
  return Math.min((done + partial) / total, 1)
}

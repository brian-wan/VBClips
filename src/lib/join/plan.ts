import { clamp, groupBySource, mergeOverlaps, type Clip, type Span } from '../clips'

export type JoinMode = 'fast' | 'precise'
/** A stretch of one source to render; `sourceIndex` is the source's position in the timeline. */
export type Segment = Span & { sourceIndex: number }

/** The output is assembled in MEMFS, so anything bigger risks running the tab out of memory. */
export const MAX_OUTPUT_BYTES = 1.5e9
/** From this size the dialog warns that the browser may run out of memory. */
export const LARGE_OUTPUT_BYTES = 500e6
/** On a touch device the dialog warns from this size, since phones have far less memory. */
export const TOUCH_LARGE_OUTPUT_BYTES = 200e6
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
const PRECISE_THREADS = '4'

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
    // Keep the source's frame timing: without this, variable-frame-rate input (screen
    // recordings) is padded to a constant 120 fps by duplicating frames.
    ...['-fps_mode', 'passthrough', '-avoid_negative_ts', 'make_zero'],
    ...['-movflags', '+faststart', segmentFileName(index)],
  ]
}

/** Where the probe of a segment writes its JSON. */
export const PROBE_FILE = 'probe.json'

/** ffprobe arguments that write the container start and the video stream's start and length. */
export function probeArgs(index: number): string[] {
  return [
    ...['-v', 'error', '-show_entries', 'format=start_time:stream=codec_type,start_time,duration'],
    ...['-of', 'json', segmentFileName(index), '-o', PROBE_FILE],
  ]
}

/** Seconds, as the segment file stores them. */
export type SegmentTiming = { containerStart: number; videoStart: number; videoDuration: number }

type ProbeJson = {
  format?: { start_time?: string }
  streams?: { codec_type?: string; start_time?: string; duration?: string }[]
}

/** The timing in ffprobe's JSON output, or null when any of it is missing. */
export function parseProbe(json: string): SegmentTiming | null {
  let parsed: ProbeJson
  try {
    parsed = JSON.parse(json) as ProbeJson
  } catch {
    return null
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const timing = {
    containerStart: Number(parsed.format?.start_time),
    videoStart: Number(video?.start_time),
    videoDuration: Number(video?.duration),
  }
  const valid = Object.values(timing).every((n) => Number.isFinite(n))
  return valid && timing.videoDuration > 0 ? timing : null
}

/**
 * The `duration` of each concat entry, or null to let the demuxer use the container length.
 * The demuxer lines a file up by its container start, which is the audio's when audio starts
 * first, so the video of the next file must land one video length after this file's video
 * starts: its duration is this video's length plus this file's video lead over its container
 * start, minus the next file's lead. Without the next file's timing this file's own lead stands
 * in for it.
 */
export function concatDurations(timings: readonly (SegmentTiming | null)[]): (number | null)[] {
  const lead = (timing: SegmentTiming) => timing.videoStart - timing.containerStart
  return timings.map((timing, i) => {
    if (!timing) return null
    const next = timings[i + 1] ?? timing
    const duration = timing.videoDuration + lead(timing) - lead(next)
    return duration > 0 ? duration : null
  })
}

export function concatListContent(durations: readonly (number | null)[]): string {
  return durations
    .map((duration, i) => {
      const entry = `file '${segmentFileName(i)}'\n`
      return duration === null ? entry : `${entry}duration ${duration.toFixed(3)}\n`
    })
    .join('')
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
  return clamp(time / MICROSECONDS / length, 0, 1)
}

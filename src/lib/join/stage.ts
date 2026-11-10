import { fingerprint, type VideoIdentity } from '../fingerprint'

/**
 * Join copies each source into the browser's private file system (OPFS) before mounting it.
 * Chrome on macOS takes about a second for every byte-range read of a file picked from the
 * user's own folders, and ffmpeg's WORKERFS mount reads in many small slices; one streaming copy
 * into OPFS is fast, and slices of the copy read in well under a millisecond.
 */
export const STAGE_DIR = 'vbclipper-stage'

/** Staging needs this much free quota per byte to copy, so the copy never fills the disk. */
export const STAGE_HEADROOM = 1.1

/** The worker reports the bytes copied after at least this many more, and once at the end. */
export const STAGE_REPORT_BYTES = 8e6

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** FNV-1a over the UTF-16 code units, as 16 hex digits. */
function hash64(text: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * The staged copy's name inside `STAGE_DIR`, from the source's fingerprint. The name becomes
 * the input path ffmpeg reads (`/in0/<name>`), so it is hex plus the source's own extension,
 * which helps ffmpeg pick the demuxer, and never anything ffmpeg could read as a protocol.
 */
export function stagedName(video: VideoIdentity): string {
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(video.name)?.[0].toLowerCase() ?? ''
  return `${hash64(fingerprint(video))}${extension}`
}

export type StorageEstimateLike = { quota?: number | undefined; usage?: number | undefined }

/** Whether `bytes` more fit in the origin's quota with 10% to spare. */
export function canStage(estimate: StorageEstimateLike | null, bytes: number): boolean {
  if (bytes <= 0) return true
  const { quota, usage } = estimate ?? {}
  if (!Number.isFinite(quota) || !Number.isFinite(usage)) return false
  return (quota as number) - (usage as number) >= bytes * STAGE_HEADROOM
}

/** Sum of the sizes still to copy: the work of the stage phase. */
export function stageTotal(sizes: readonly number[]): number {
  return sizes.reduce((sum, size) => sum + Math.max(size, 0), 0)
}

/** Whether the worker should report `copied` now, given what it last reported. */
export function shouldReport(copied: number, reported: number, total: number): boolean {
  return copied >= total || copied - reported >= STAGE_REPORT_BYTES
}

/** "Preparing video · 1.2 of 4.0 GB": both numbers in the unit that suits the total. */
export function stageLabel(copied: number, total: number): string {
  const [divisor, unit] = total >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB']
  const amount = (bytes: number) => (Math.max(bytes, 0) / divisor).toFixed(1)
  return `Preparing video · ${amount(Math.min(copied, total))} of ${amount(total)} ${unit}`
}

export const UNCACHED_NOTE = 'This browser cannot cache the video, so joining may be slow.'

/**
 * Delivering the joined video. Where the browser has a save dialog (`showSaveFilePicker`, Chrome
 * and Edge on desktop), the user picks where the file goes and the app writes it there with
 * progress. Elsewhere, and on touch devices for now, the file is handed to the browser as a
 * download.
 */
export type SaveMethod = 'picker' | 'download'

export function saveMethod(hasPicker: boolean, touch: boolean): SaveMethod {
  return hasPicker && !touch ? 'picker' : 'download'
}

/** Each write hands the file this many bytes, so the progress line moves on large files. */
export const SAVE_CHUNK_BYTES = 16e6

export type ByteRange = { start: number; end: number }

/** The ranges `size` bytes are written in, in order; none for an empty file. */
export function saveChunks(size: number, chunkBytes = SAVE_CHUNK_BYTES): ByteRange[] {
  const ranges: ByteRange[] = []
  const step = Math.max(1, Math.floor(chunkBytes))
  for (let start = 0; start < size; start += step) {
    ranges.push({ start, end: Math.min(start + step, size) })
  }
  return ranges
}

/** "Saving · 412 of 980 MB": whole megabytes, one decimal for files under 10 MB. */
export function savingLabel(written: number, total: number): string {
  const digits = total < 10e6 ? 1 : 0
  const amount = (bytes: number) => (Math.max(bytes, 0) / 1e6).toFixed(digits)
  return `Saving · ${amount(Math.min(written, total))} of ${amount(total)} MB`
}

export const savedLabel = (fileName: string) => `Saved to ${fileName}`

/** The save dialog rejects with an `AbortError` when the user closes it without choosing. */
export function isPickerCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** The part of `FileSystemWritableFileStream` the save needs. */
export type WritableTarget = {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

/**
 * Writes `blob` to `target` chunk by chunk, reporting bytes written after each. A failed write
 * aborts the target, so a half-written file is never committed.
 */
export async function writeBlob(
  target: WritableTarget,
  blob: Blob,
  onProgress: (written: number, total: number) => void,
  chunkBytes = SAVE_CHUNK_BYTES,
): Promise<void> {
  try {
    onProgress(0, blob.size)
    for (const { start, end } of saveChunks(blob.size, chunkBytes)) {
      await target.write(blob.slice(start, end))
      onProgress(end, blob.size)
    }
    await target.close()
  } catch (error) {
    await target.abort().catch(() => undefined)
    throw error
  }
}

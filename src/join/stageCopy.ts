import { shouldReport } from '../lib/join/stage'

/*
 * The worker half of staging: streams a picked `File` into the origin private file system with a
 * `FileSystemSyncAccessHandle`, which only dedicated workers have. The DOM lib types lack the
 * sync handle, so the slices used here are declared locally; tests pass fakes of the same shape.
 */

export interface SyncAccessHandleLike {
  write(buffer: Uint8Array, options: { at: number }): number
  truncate(size: number): void
  flush(): void
  close(): void
}

export interface FileHandleLike {
  /** Missing in browsers without sync access handles (older Safari) and outside workers. */
  createSyncAccessHandle?: () => Promise<SyncAccessHandleLike>
  getFile(): Promise<File>
}

export interface DirectoryLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
}

export type StageRequest =
  { type: 'stage'; file: File; dir: string; name: string } | { type: 'abort' }

export type StageReply =
  | { type: 'progress'; copied: number }
  | { type: 'done'; file: File }
  /** No private file system or no sync access handles: mount the original instead. */
  | { type: 'unsupported' }
  | { type: 'error'; message: string }
  /** Stopped; the partial copy has been removed. */
  | { type: 'aborted' }

export class StageUnsupported extends Error {
  constructor() {
    super('This browser cannot write to the private file system from a worker')
    this.name = 'StageUnsupported'
  }
}

export type StageFileOptions = {
  root: DirectoryLike
  file: File
  dir: string
  name: string
  /** Bytes copied so far, every few megabytes and once at the end. */
  onCopied: (copied: number) => void
  signal: AbortSignal
}

/**
 * Copies `file` to `<dir>/<name>` with one streaming read and returns the copy. Aborting
 * `signal` cancels the read; any failure, abort included, removes the partial copy.
 */
export async function stageFile({
  root,
  file,
  dir,
  name,
  onCopied,
  signal,
}: StageFileOptions): Promise<File> {
  signal.throwIfAborted()
  const folder = await root.getDirectoryHandle(dir, { create: true })
  const handle = await folder.getFileHandle(name, { create: true })
  const removePartial = () => folder.removeEntry(name).catch(() => undefined)
  if (typeof handle.createSyncAccessHandle !== 'function') {
    await removePartial()
    throw new StageUnsupported()
  }
  const access = await handle.createSyncAccessHandle()
  let complete = false
  try {
    access.truncate(0)
    const reader = file.stream().getReader()
    const cancel = () => void reader.cancel().catch(() => undefined)
    signal.addEventListener('abort', cancel, { once: true })
    try {
      let copied = 0
      let reported = 0
      for (;;) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        for (let offset = 0; offset < value.byteLength;) {
          const written = access.write(value.subarray(offset), { at: copied + offset })
          if (!(written > 0)) throw new Error('Could not write the staged copy')
          offset += written
        }
        copied += value.byteLength
        if (shouldReport(copied, reported, file.size)) {
          reported = copied
          onCopied(copied)
        }
      }
      if (reported !== copied) onCopied(copied)
      access.flush()
      complete = true
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } finally {
    access.close()
    if (!complete) await removePartial()
  }
  return handle.getFile()
}

export interface WorkerScopeLike {
  addEventListener(type: 'message', listener: (event: { data: StageRequest }) => void): void
  postMessage(message: StageReply): void
}

/**
 * Serves one staging request per worker: `stage` starts the copy, `abort` stops it. The reply
 * is `done` with the copy, `aborted` once the partial copy is gone, `unsupported`, or `error`.
 */
export function serveStaging(scope: WorkerScopeLike, getRoot: () => Promise<DirectoryLike>): void {
  const controller = new AbortController()
  scope.addEventListener('message', ({ data }) => {
    if (data.type === 'abort') {
      controller.abort()
      return
    }
    void (async () => {
      let root: DirectoryLike
      try {
        root = await getRoot()
      } catch {
        scope.postMessage({ type: 'unsupported' })
        return
      }
      try {
        const file = await stageFile({
          root,
          file: data.file,
          dir: data.dir,
          name: data.name,
          onCopied: (copied) => scope.postMessage({ type: 'progress', copied }),
          signal: controller.signal,
        })
        scope.postMessage({ type: 'done', file })
      } catch (error) {
        if (controller.signal.aborted) scope.postMessage({ type: 'aborted' })
        else if (error instanceof StageUnsupported) scope.postMessage({ type: 'unsupported' })
        else {
          const message = error instanceof Error ? error.message : String(error)
          scope.postMessage({ type: 'error', message })
        }
      }
    })()
  })
}

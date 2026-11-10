import {
  STAGE_DIR,
  canStage,
  stageTotal,
  stagedName,
  type StorageEstimateLike,
} from '../lib/join/stage'
import type { StageListener, Stager } from '../lib/join/runner'
import type { DirectoryLike, StageReply, StageRequest } from './stageCopy'

/** The slice of `navigator.storage` staging uses. */
export interface StorageLike {
  getDirectory(): Promise<DirectoryLike>
  estimate(): Promise<StorageEstimateLike>
}

export interface StageWorkerLike {
  postMessage(message: StageRequest): void
  addEventListener(type: 'message', listener: (event: { data: StageReply }) => void): void
  addEventListener(type: 'error', listener: () => void): void
  terminate(): void
}

export type StageStoreOptions = {
  /** Null when the browser has no private file system. */
  storage?: () => StorageLike | null
  createWorker?: () => StageWorkerLike
}

function browserStorage(): StorageLike | null {
  if (typeof navigator === 'undefined') return null
  const storage = navigator.storage as StorageManager | undefined
  if (typeof storage?.getDirectory !== 'function') return null
  return storage
}

function browserWorker(): StageWorkerLike {
  return new Worker(new URL('./stage.worker.ts', import.meta.url), {
    type: 'module',
  })
}

const abortError = () => new DOMException('Staging stopped', 'AbortError')

/**
 * Staged copies of the editor's sources in the origin private file system, under
 * `vbclipper-stage/`, one per source fingerprint. Later joins in the same editor session reuse
 * them; `clear` deletes them when the editor exits and at app start.
 */
export class StageStore implements Stager {
  private readonly storage: () => StorageLike | null
  private readonly createWorker: () => StageWorkerLike
  /** Copies in flight, so `clear` can stop them and wait until their partial files are gone. */
  private readonly running = new Map<AbortController, Promise<unknown>>()

  constructor(options: StageStoreOptions = {}) {
    this.storage = options.storage ?? browserStorage
    this.createWorker = options.createWorker ?? browserWorker
  }

  private async folder(storage: StorageLike): Promise<DirectoryLike | null> {
    try {
      const root = await storage.getDirectory()
      return await root.getDirectoryHandle(STAGE_DIR, { create: true })
    } catch {
      return null
    }
  }

  /** The finished copy of each file already in `folder`, or null where one is still needed. */
  private async existing(folder: DirectoryLike, files: readonly File[]): Promise<(File | null)[]> {
    return Promise.all(
      files.map(async (file) => {
        try {
          const handle = await folder.getFileHandle(stagedName(file))
          const copy = await handle.getFile()
          return copy.size === file.size ? copy : null
        } catch {
          return null
        }
      }),
    )
  }

  /** Free quota for every copy still needed, with 10% to spare. */
  private async fits(storage: StorageLike, bytes: number): Promise<boolean> {
    const estimate = await storage.estimate().catch(() => null)
    return canStage(estimate, bytes)
  }

  /**
   * Whether `files` can be staged here, as far as the page can tell before starting: a private
   * file system and room for the copies. A browser without sync access handles is only found out
   * when the worker starts, and `stage` then resolves to null.
   */
  async available(files: readonly File[]): Promise<boolean> {
    const storage = this.storage()
    if (!storage) return false
    const folder = await this.folder(storage)
    if (!folder) return false
    const copies = await this.existing(folder, files)
    return this.fits(storage, stageTotal(files.filter((_, i) => !copies[i]).map((f) => f.size)))
  }

  async stage(
    files: readonly File[],
    onProgress: StageListener,
    signal?: AbortSignal,
  ): Promise<File[] | null> {
    signal?.throwIfAborted()
    const storage = this.storage()
    if (!storage) return null
    const folder = await this.folder(storage)
    if (!folder) return null
    const copies = await this.existing(folder, files)
    const missing = files.flatMap((file, i) => (copies[i] ? [] : [{ file, i }]))
    const total = stageTotal(missing.map(({ file }) => file.size))
    if (missing.length > 0) {
      if (!(await this.fits(storage, total))) return null
      signal?.throwIfAborted()
      onProgress(0, total)
      let before = 0
      for (const { file, i } of missing) {
        const copy = await this.copy(file, (copied) => onProgress(before + copied, total), signal)
        if (!copy) return null
        copies[i] = copy
        before += file.size
      }
    }
    return copies.filter((copy): copy is File => copy !== null)
  }

  /** One worker per copy. Null when the worker cannot stage; rejects when stopped. */
  private copy(
    file: File,
    onCopied: (copied: number) => void,
    signal: AbortSignal | undefined,
  ): Promise<File | null> {
    const controller = new AbortController()
    const forward = () => controller.abort()
    signal?.addEventListener('abort', forward, { once: true })
    const copying = new Promise<File | null>((resolve, reject) => {
      let worker: StageWorkerLike
      try {
        worker = this.createWorker()
      } catch {
        resolve(null)
        return
      }
      const settle = (outcome: () => void) => {
        controller.signal.removeEventListener('abort', stop)
        worker.terminate()
        outcome()
      }
      const stop = () => worker.postMessage({ type: 'abort' })
      worker.addEventListener('error', () => settle(() => resolve(null)))
      worker.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') {
          if (!controller.signal.aborted) onCopied(data.copied)
        } else if (data.type === 'done') {
          settle(() => (controller.signal.aborted ? reject(abortError()) : resolve(data.file)))
        } else if (data.type === 'aborted') {
          settle(() => reject(abortError()))
        } else {
          settle(() => (controller.signal.aborted ? reject(abortError()) : resolve(null)))
        }
      })
      controller.signal.addEventListener('abort', stop, { once: true })
      worker.postMessage({ type: 'stage', file, dir: STAGE_DIR, name: stagedName(file) })
      if (controller.signal.aborted) stop()
    })
    const tracked = copying.finally(() => {
      signal?.removeEventListener('abort', forward)
      this.running.delete(controller)
    })
    this.running.set(
      controller,
      tracked.catch(() => undefined),
    )
    return tracked
  }

  /** Stops any copy in flight, waits for its partial file to go, then deletes every copy. */
  async clear(): Promise<void> {
    for (const controller of this.running.keys()) controller.abort()
    await Promise.all(this.running.values())
    const storage = this.storage()
    if (!storage) return
    try {
      const root = await storage.getDirectory()
      await root.removeEntry(STAGE_DIR, { recursive: true })
    } catch {
      // Nothing staged, or a copy another tab still holds open; the next app start retries.
    }
  }
}

let shared: StageStore | null = null

/** One store for the page, so copies made by one join are found by the next. */
export function getStager(): StageStore {
  shared ??= new StageStore()
  return shared
}

/** Deletes every staged copy: when the editor exits, and leftovers when the app starts. */
export function clearStaged(): Promise<void> {
  return getStager().clear()
}

import { describe, expect, it, vi } from 'vitest'
import { STAGE_DIR, stagedName } from '../lib/join/stage'
import type { DirectoryLike, FileHandleLike, StageReply, StageRequest } from './stageCopy'
import { StageStore, type StageWorkerLike, type StorageLike } from './staging'

/** An OPFS directory tree holding plain files. */
class Folder implements DirectoryLike {
  files = new Map<string, File>()
  folders = new Map<string, Folder>()
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Folder> {
    let folder = this.folders.get(name)
    if (!folder && options?.create) {
      folder = new Folder()
      this.folders.set(name, folder)
    }
    return folder ? Promise.resolve(folder) : Promise.reject(new DOMException('', 'NotFoundError'))
  }
  getFileHandle(name: string): Promise<FileHandleLike> {
    const file = this.files.get(name)
    if (!file) return Promise.reject(new DOMException('', 'NotFoundError'))
    return Promise.resolve({ getFile: () => Promise.resolve(file) })
  }
  removeEntry(name: string) {
    this.files.delete(name)
    this.folders.delete(name)
    return Promise.resolve()
  }
}

type Behaviour = 'copy' | 'unsupported' | 'error' | 'hang'

/** Stands in for the staging worker: writes the copy into `root` in two progress steps. */
class FakeWorker implements StageWorkerLike {
  posted: StageRequest['type'][] = []
  terminated = false
  private onMessage: (event: { data: StageReply }) => void = () => undefined
  private readonly root: Folder
  private readonly behaviour: Behaviour
  constructor(root: Folder, behaviour: Behaviour) {
    this.root = root
    this.behaviour = behaviour
  }
  addEventListener(type: 'message' | 'error', listener: (event: { data: StageReply }) => void) {
    if (type === 'message') this.onMessage = listener
  }
  private reply(data: StageReply) {
    queueMicrotask(() => this.onMessage({ data }))
  }
  postMessage(message: StageRequest) {
    this.posted.push(message.type)
    if (message.type === 'abort') {
      void this.root.getDirectoryHandle(STAGE_DIR).then((dir) => dir.files.clear())
      this.reply({ type: 'aborted' })
      return
    }
    if (this.behaviour === 'unsupported') return this.reply({ type: 'unsupported' })
    if (this.behaviour === 'error') return this.reply({ type: 'error', message: 'disk full' })
    const { file, name } = message
    void this.root.getDirectoryHandle(STAGE_DIR, { create: true }).then((dir) => {
      const copy = new File([new Uint8Array(file.size)], name)
      const written = this.behaviour === 'hang' ? new File(['x'], name) : copy
      dir.files.set(name, written)
      this.reply({ type: 'progress', copied: Math.floor(file.size / 2) })
      if (this.behaviour === 'hang') return
      this.reply({ type: 'progress', copied: file.size })
      this.reply({ type: 'done', file: copy })
    })
  }
  terminate() {
    this.terminated = true
  }
}

function setup(
  options: { behaviour?: Behaviour; quota?: number; usage?: number; noStorage?: boolean } = {},
) {
  const root = new Folder()
  const workers: FakeWorker[] = []
  const storage: StorageLike = {
    getDirectory: () => Promise.resolve(root),
    estimate: () => Promise.resolve({ quota: options.quota ?? 1e12, usage: options.usage ?? 0 }),
  }
  const store = new StageStore({
    storage: () => (options.noStorage ? null : storage),
    createWorker: () => {
      const worker = new FakeWorker(root, options.behaviour ?? 'copy')
      workers.push(worker)
      return worker
    },
  })
  return { root, storage, store, workers }
}

const source = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { lastModified: 1_700_000_000_000 })
const game = source('game.mov', 1000)
const court = source('court2.mp4', 3000)

describe('StageStore.stage', () => {
  it('copies each source in a worker and reports bytes across all of them', async () => {
    const { store, workers } = setup()
    const progress: [number, number][] = []
    const copies = await store.stage([game, court], (copied, total) =>
      progress.push([copied, total]),
    )

    expect(copies?.map((f) => f.name)).toEqual([stagedName(game), stagedName(court)])
    expect(progress).toEqual([
      [0, 4000],
      [500, 4000],
      [1000, 4000],
      [2500, 4000],
      [4000, 4000],
    ])
    expect(workers.map((w) => w.terminated)).toEqual([true, true])
  })

  it('reuses a finished copy without copying or reporting anything', async () => {
    const { store, workers } = setup()
    await store.stage([game], () => undefined)
    const progress: number[] = []
    const copies = await store.stage([game], (copied) => progress.push(copied))
    expect(copies?.map((f) => f.name)).toEqual([stagedName(game)])
    expect(workers).toHaveLength(1)
    expect(progress).toEqual([])
  })

  it('copies again over a partial copy left by a crashed tab', async () => {
    const { root, store, workers } = setup()
    const dir = await root.getDirectoryHandle(STAGE_DIR, { create: true })
    dir.files.set(stagedName(game), new File(['x'], stagedName(game)))
    await store.stage([game], () => undefined)
    expect(workers).toHaveLength(1)
  })

  it('gives up, so the originals are mounted, without a private file system', async () => {
    expect(await setup({ noStorage: true }).store.stage([game], () => undefined)).toBeNull()
    const { store, storage } = setup()
    storage.getDirectory = () => Promise.reject(new DOMException('blocked', 'SecurityError'))
    expect(await store.stage([game], () => undefined)).toBeNull()
  })

  it('gives up when the copies need more than the free quota less 10%', async () => {
    const { store, workers } = setup({ quota: 5000, usage: 601 })
    expect(await store.stage([game, court], () => undefined)).toBeNull()
    expect(workers).toEqual([])
    expect(await setup({ quota: 5000, usage: 600 }).store.stage([game, court], () => 0)).toEqual([
      expect.any(File),
      expect.any(File),
    ])
  })

  it('gives up when the worker has no sync access handles or the copy fails', async () => {
    expect(await setup({ behaviour: 'unsupported' }).store.stage([game], () => 0)).toBeNull()
    expect(await setup({ behaviour: 'error' }).store.stage([game], () => 0)).toBeNull()
  })

  it('stops the copy on abort, after the worker has removed the partial file', async () => {
    const { root, store, workers } = setup({ behaviour: 'hang' })
    const controller = new AbortController()
    const staging = store.stage([game], () => undefined, controller.signal)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    controller.abort()
    await expect(staging).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]?.posted).toEqual(['stage', 'abort'])
    expect(workers[0]?.terminated).toBe(true)
    const dir = await root.getDirectoryHandle(STAGE_DIR)
    expect(dir.files.size).toBe(0)
  })
})

describe('StageStore.available', () => {
  it('checks the private file system and the quota for copies not yet made', async () => {
    const { store } = setup({ quota: 1500, usage: 0 })
    expect(await store.available([game])).toBe(true)
    expect(await store.available([game, court])).toBe(false)
    await store.stage([game], () => undefined)
    expect(await store.available([game])).toBe(true)
    expect(await setup({ noStorage: true }).store.available([game])).toBe(false)
  })
})

describe('StageStore.clear', () => {
  it('deletes every staged copy', async () => {
    const { root, store } = setup()
    await store.stage([game, court], () => undefined)
    await store.clear()
    expect(root.folders.has(STAGE_DIR)).toBe(false)
  })

  it('stops a copy in flight and waits for it before deleting', async () => {
    const { root, store, workers } = setup({ behaviour: 'hang' })
    const staging = store.stage([game], () => undefined)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    await store.clear()
    await expect(staging).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]?.posted).toEqual(['stage', 'abort'])
    expect(root.folders.has(STAGE_DIR)).toBe(false)
  })

  it('does nothing without a private file system', async () => {
    await expect(setup({ noStorage: true }).store.clear()).resolves.toBeUndefined()
  })
})

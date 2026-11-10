import { describe, expect, it, vi } from 'vitest'
import {
  serveStaging,
  stageFile,
  type DirectoryLike,
  type FileHandleLike,
  type StageReply,
  type StageRequest,
  type SyncAccessHandleLike,
} from './stageCopy'

const MB = 1e6

class FakeAccess implements SyncAccessHandleLike {
  bytes = new Uint8Array(0)
  closed = false
  flushed = false
  /** Bytes each write accepts at most, to exercise short writes. */
  private readonly maxWrite: number
  constructor(maxWrite = Infinity) {
    this.maxWrite = maxWrite
  }
  write(buffer: Uint8Array, { at }: { at: number }) {
    const length = Math.min(buffer.byteLength, this.maxWrite)
    const end = at + length
    if (end > this.bytes.byteLength) {
      const grown = new Uint8Array(end)
      grown.set(this.bytes)
      this.bytes = grown
    }
    this.bytes.set(buffer.subarray(0, length), at)
    return length
  }
  truncate(size: number) {
    this.bytes = this.bytes.slice(0, size)
  }
  flush() {
    this.flushed = true
  }
  close() {
    this.closed = true
  }
}

class FakeFolder implements DirectoryLike {
  entries = new Map<string, FakeAccess>()
  folders = new Map<string, FakeFolder>()
  removed: string[] = []
  private readonly access: () => FakeAccess
  private readonly syncHandles: boolean
  constructor(access: () => FakeAccess = () => new FakeAccess(), syncHandles = true) {
    this.access = access
    this.syncHandles = syncHandles
  }
  getDirectoryHandle(name: string) {
    let folder = this.folders.get(name)
    if (!folder) {
      folder = new FakeFolder(this.access, this.syncHandles)
      this.folders.set(name, folder)
    }
    return Promise.resolve(folder)
  }
  getFileHandle(name: string): Promise<FileHandleLike> {
    const handle: FileHandleLike = {
      getFile: () => {
        const bytes = this.entries.get(name)?.bytes ?? new Uint8Array(0)
        return Promise.resolve(new File([bytes], name))
      },
    }
    if (this.syncHandles) {
      handle.createSyncAccessHandle = () => {
        const access = this.access()
        this.entries.set(name, access)
        return Promise.resolve(access)
      }
    }
    return Promise.resolve(handle)
  }
  removeEntry(name: string) {
    this.removed.push(name)
    this.entries.delete(name)
    return Promise.resolve()
  }
}

/** A file whose stream yields `chunks` one by one, waiting on `gate` before chunk `gateAt`. */
function fakeFile(chunks: Uint8Array[], gate?: { at: number; until: Promise<void> }) {
  const size = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  let cancelled = false
  const file = {
    size,
    stream: () => {
      let i = 0
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (gate && i === gate.at) await gate.until
          if (cancelled) return
          const chunk = chunks[i++]
          if (chunk) controller.enqueue(chunk)
          else controller.close()
        },
        cancel() {
          cancelled = true
        },
      })
    },
  }
  return { file: file as unknown as File, wasCancelled: () => cancelled }
}

const chunk = (bytes: number, fill: number) => new Uint8Array(bytes).fill(fill)

describe('stageFile', () => {
  it('streams the file into the staged copy, reporting every 8 MB and at the end', async () => {
    const root = new FakeFolder()
    const { file } = fakeFile([chunk(5 * MB, 1), chunk(5 * MB, 2), chunk(1 * MB, 3)])
    const reports: number[] = []
    const copy = await stageFile({
      root,
      file,
      dir: 'vbclipper-stage',
      name: 'abc.mov',
      onCopied: (copied) => reports.push(copied),
      signal: new AbortController().signal,
    })

    expect(reports).toEqual([10 * MB, 11 * MB])
    expect(copy.size).toBe(11 * MB)
    const access = root.folders.get('vbclipper-stage')?.entries.get('abc.mov')
    expect(access?.flushed).toBe(true)
    expect(access?.closed).toBe(true)
    expect([access?.bytes[0], access?.bytes[5 * MB], access?.bytes[11 * MB - 1]]).toEqual([1, 2, 3])
  })

  it('keeps writing after a short write', async () => {
    const root = new FakeFolder(() => new FakeAccess(3))
    const { file } = fakeFile([new Uint8Array([1, 2, 3, 4, 5, 6, 7])])
    const copy = await stageFile({
      root,
      file,
      dir: 'd',
      name: 'n',
      onCopied: () => undefined,
      signal: new AbortController().signal,
    })
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))
  })

  it('stops the stream and removes the partial copy when aborted', async () => {
    const root = new FakeFolder()
    let open = () => undefined as void
    const until = new Promise<void>((resolve) => {
      open = resolve
    })
    const { file, wasCancelled } = fakeFile([chunk(MB, 1), chunk(MB, 2)], { at: 1, until })
    const controller = new AbortController()
    const staging = stageFile({
      root,
      file,
      dir: 'd',
      name: 'partial.mov',
      onCopied: () => undefined,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(root.folders.get('d')?.entries.size).toBe(1))
    const access = root.folders.get('d')?.entries.get('partial.mov')
    controller.abort()
    open()
    await expect(staging).rejects.toThrow()
    expect(wasCancelled()).toBe(true)
    expect(access?.closed).toBe(true)
    expect(root.folders.get('d')?.removed).toEqual(['partial.mov'])
  })

  it('removes the empty entry and fails as unsupported without sync access handles', async () => {
    const root = new FakeFolder(undefined, false)
    const { file } = fakeFile([chunk(10, 1)])
    await expect(
      stageFile({
        root,
        file,
        dir: 'd',
        name: 'n',
        onCopied: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: 'StageUnsupported' })
    expect(root.folders.get('d')?.removed).toEqual(['n'])
  })
})

/** A worker scope that records replies and lets the test send requests. */
function fakeScope() {
  const replies: StageReply[] = []
  let listener: (event: { data: StageRequest }) => void = () => undefined
  return {
    replies,
    send: (data: StageRequest) => listener({ data }),
    scope: {
      addEventListener: (_: 'message', l: (event: { data: StageRequest }) => void) => {
        listener = l
      },
      postMessage: (reply: StageReply) => replies.push(reply),
    },
  }
}

describe('serveStaging', () => {
  it('replies with progress and then the staged file', async () => {
    const { scope, send, replies } = fakeScope()
    serveStaging(scope, () => Promise.resolve(new FakeFolder()))
    send({ type: 'stage', file: fakeFile([chunk(9 * MB, 1)]).file, dir: 'd', name: 'n' })
    await vi.waitFor(() => expect(replies.at(-1)?.type).toBe('done'))
    expect(replies[0]).toEqual({ type: 'progress', copied: 9 * MB })
    const done = replies.at(-1)
    expect(done?.type === 'done' && done.file.size).toBe(9 * MB)
  })

  it('replies unsupported when the private file system is missing', async () => {
    const { scope, send, replies } = fakeScope()
    serveStaging(scope, () => Promise.reject(new Error('SecurityError')))
    send({ type: 'stage', file: fakeFile([chunk(1, 1)]).file, dir: 'd', name: 'n' })
    await vi.waitFor(() => expect(replies).toEqual([{ type: 'unsupported' }]))
  })

  it('replies aborted once the partial copy is gone', async () => {
    const { scope, send, replies } = fakeScope()
    const root = new FakeFolder()
    serveStaging(scope, () => Promise.resolve(root))
    const until = new Promise<void>(() => undefined)
    send({
      type: 'stage',
      file: fakeFile([chunk(1, 1), chunk(1, 2)], { at: 1, until }).file,
      dir: 'd',
      name: 'n',
    })
    await vi.waitFor(() => expect(root.folders.get('d')?.entries.size).toBe(1))
    send({ type: 'abort' })
    await vi.waitFor(() => expect(replies.at(-1)).toEqual({ type: 'aborted' }))
    expect(root.folders.get('d')?.removed).toEqual(['n'])
  })

  it('replies with the error when the copy fails', async () => {
    const { scope, send, replies } = fakeScope()
    const failing = new FakeFolder(() => {
      const access = new FakeAccess()
      access.write = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return access
    })
    serveStaging(scope, () => Promise.resolve(failing))
    send({ type: 'stage', file: fakeFile([chunk(1, 1)]).file, dir: 'd', name: 'n' })
    await vi.waitFor(() =>
      expect(replies.at(-1)).toEqual({ type: 'error', message: 'Quota exceeded' }),
    )
    expect(failing.folders.get('d')?.removed).toEqual(['n'])
  })
})

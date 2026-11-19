import { describe, expect, it } from 'vitest'
import {
  isPickerCancel,
  saveChunks,
  saveMethod,
  savedLabel,
  savingLabel,
  writeBlob,
  type WritableTarget,
} from './save'

describe('saveMethod', () => {
  it('uses the save dialog only on a desktop browser that has one', () => {
    expect(saveMethod(true, false)).toBe('picker')
    expect(saveMethod(false, false)).toBe('download')
    expect(saveMethod(true, true)).toBe('download')
    expect(saveMethod(false, true)).toBe('download')
  })
})

describe('saveChunks', () => {
  it('covers every byte once, in order, with a short last chunk', () => {
    expect(saveChunks(25, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
    ])
  })

  it('writes an exact multiple without an empty chunk, and nothing for an empty file', () => {
    expect(saveChunks(20, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ])
    expect(saveChunks(0, 10)).toEqual([])
  })
})

describe('savingLabel', () => {
  it('shows whole megabytes for large files', () => {
    expect(savingLabel(412e6, 980e6)).toBe('Saving · 412 of 980 MB')
    expect(savingLabel(980e6, 980e6)).toBe('Saving · 980 of 980 MB')
  })

  it('keeps one decimal for small files and never shows more than the total', () => {
    expect(savingLabel(1.25e6, 3.5e6)).toBe('Saving · 1.3 of 3.5 MB')
    expect(savingLabel(5e6, 3.5e6)).toBe('Saving · 3.5 of 3.5 MB')
  })

  it('names the saved file', () => {
    expect(savedLabel('game-highlights.mp4')).toBe('Saved to game-highlights.mp4')
  })
})

describe('isPickerCancel', () => {
  it('recognises the dialog being closed, and nothing else', () => {
    expect(isPickerCancel(new DOMException('The user aborted a request.', 'AbortError'))).toBe(true)
    expect(isPickerCancel(new DOMException('Not allowed', 'NotAllowedError'))).toBe(false)
    expect(isPickerCancel(new Error('disk full'))).toBe(false)
    expect(isPickerCancel('AbortError')).toBe(false)
  })
})

function fakeTarget(failAt = -1) {
  const writes: number[] = []
  const calls: string[] = []
  const target: WritableTarget = {
    write: (data) => {
      if (writes.length === failAt) return Promise.reject(new Error('disk full'))
      writes.push(data.size)
      return Promise.resolve()
    },
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
    abort: () => {
      calls.push('abort')
      return Promise.resolve()
    },
  }
  return { target, writes, calls }
}

describe('writeBlob', () => {
  it('writes the blob in chunks, reporting bytes written, then closes', async () => {
    const { target, writes, calls } = fakeTarget()
    const reports: [number, number][] = []
    await writeBlob(target, new Blob([new Uint8Array(25)]), (w, t) => reports.push([w, t]), 10)
    expect(writes).toEqual([10, 10, 5])
    expect(reports).toEqual([
      [0, 25],
      [10, 25],
      [20, 25],
      [25, 25],
    ])
    expect(calls).toEqual(['close'])
  })

  it('aborts the file instead of closing it when a write fails', async () => {
    const { target, calls } = fakeTarget(1)
    const reports: number[] = []
    await expect(
      writeBlob(target, new Blob([new Uint8Array(25)]), (w) => reports.push(w), 10),
    ).rejects.toThrow('disk full')
    expect(reports).toEqual([0, 10])
    expect(calls).toEqual(['abort'])
  })
})

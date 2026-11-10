import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceFiles } from './sourceFiles'

describe('SourceFiles.retain', () => {
  afterEach(() => vi.restoreAllMocks())

  it('revokes the URLs of dropped sources only', () => {
    let next = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${next++}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const files = new SourceFiles()
    for (const id of ['a', 'b', 'c']) files.add(id, new File([id], `${id}.mp4`))
    const urls = ['a', 'b', 'c'].map((id) => files.url(id))

    files.retain(new Set(['a', 'c']))
    expect(revoke.mock.calls).toEqual([[urls[1]]])
    expect(files.url('a')).toBe(urls[0])

    // The file is kept, so undoing the removal gets a fresh URL.
    expect(files.url('b')).toBe('blob:3')
  })
})

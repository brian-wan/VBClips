import { describe, expect, it } from 'vitest'
import { fingerprint } from './fingerprint'

const video = { name: 'match.mp4', size: 1234, lastModified: 1700000000000 }

describe('fingerprint', () => {
  it('joins name, size and lastModified', () => {
    expect(fingerprint(video)).toBe('match.mp4|1234|1700000000000')
  })

  it('matches the same file and ignores extra fields', () => {
    expect(fingerprint({ ...video, duration: 60 } as typeof video)).toBe(fingerprint(video))
  })

  it.each([
    ['name', { ...video, name: 'other.mp4' }],
    ['size', { ...video, size: 1235 }],
    ['lastModified', { ...video, lastModified: 1 }],
  ])('rejects a different %s', (_, other) => {
    expect(fingerprint(other)).not.toBe(fingerprint(video))
  })
})

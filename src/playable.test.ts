import { describe, expect, it } from 'vitest'
import { canProbablyPlay } from './playable'

const fileOfType = (type: string) => new File([''], 'game.ext', { type })

describe('canProbablyPlay', () => {
  it('accepts every video type, including containers canPlayType is unsure about', () => {
    for (const type of ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']) {
      expect(canProbablyPlay(fileOfType(type))).toBe(true)
    }
  })

  it('accepts a file with no declared type', () => {
    expect(canProbablyPlay(fileOfType(''))).toBe(true)
  })

  it('rejects files that are not video', () => {
    expect(canProbablyPlay(fileOfType('image/png'))).toBe(false)
    expect(canProbablyPlay(fileOfType('application/pdf'))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  STAGE_REPORT_BYTES,
  canStage,
  shouldReport,
  stageLabel,
  stageTotal,
  stagedName,
} from './stage'

const video = { name: 'Saturday Game.MOV', size: 4_000_000_000, lastModified: 1_700_000_000_000 }

describe('stagedName', () => {
  it('is 16 hex digits from the fingerprint plus the lowercased extension', () => {
    expect(stagedName(video)).toMatch(/^[0-9a-f]{16}\.mov$/)
  })

  it('is stable for one source and differs when any part of the fingerprint differs', () => {
    expect(stagedName(video)).toBe(stagedName({ ...video }))
    const others = [
      { ...video, name: 'Sunday Game.MOV' },
      { ...video, size: video.size + 1 },
      { ...video, lastModified: video.lastModified + 1 },
    ].map(stagedName)
    expect(new Set([stagedName(video), ...others]).size).toBe(4)
  })

  it('drops an extension ffmpeg could misread and keeps names without one plain', () => {
    expect(stagedName({ ...video, name: 'clip' })).toMatch(/^[0-9a-f]{16}$/)
    expect(stagedName({ ...video, name: 'clip.m p4' })).toMatch(/^[0-9a-f]{16}$/)
    expect(stagedName({ ...video, name: 'a:b|c.mp4' })).toMatch(/^[0-9a-f]{16}\.mp4$/)
  })
})

describe('canStage', () => {
  it('needs the bytes to copy plus 10% free', () => {
    expect(canStage({ quota: 1100, usage: 0 }, 1000)).toBe(true)
    expect(canStage({ quota: 1099, usage: 0 }, 1000)).toBe(false)
    expect(canStage({ quota: 2000, usage: 900 }, 1000)).toBe(true)
    expect(canStage({ quota: 2000, usage: 901 }, 1000)).toBe(false)
  })

  it('refuses when the browser gives no usable estimate', () => {
    expect(canStage(null, 1000)).toBe(false)
    expect(canStage({ quota: 5000 }, 1000)).toBe(false)
    expect(canStage({ quota: Number.NaN, usage: 0 }, 1000)).toBe(false)
  })

  it('always allows copying nothing', () => {
    expect(canStage(null, 0)).toBe(true)
  })
})

describe('stage progress', () => {
  it('sums the sizes still to copy', () => {
    expect(stageTotal([])).toBe(0)
    expect(stageTotal([25e6, 243e6])).toBe(268e6)
  })

  it('reports every 8 MB and at the end', () => {
    expect(shouldReport(STAGE_REPORT_BYTES - 1, 0, 100e6)).toBe(false)
    expect(shouldReport(STAGE_REPORT_BYTES, 0, 100e6)).toBe(true)
    expect(shouldReport(20e6, 16e6, 100e6)).toBe(false)
    expect(shouldReport(3e6, 0, 3e6)).toBe(true)
  })

  it('labels the copy in GB for big sources and MB otherwise', () => {
    expect(stageLabel(1.2e9, 4e9)).toBe('Preparing video · 1.2 of 4.0 GB')
    expect(stageLabel(12.34e6, 25e6)).toBe('Preparing video · 12.3 of 25.0 MB')
    expect(stageLabel(30e6, 25e6)).toBe('Preparing video · 25.0 of 25.0 MB')
  })
})

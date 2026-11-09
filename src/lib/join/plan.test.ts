import { describe, expect, it } from 'vitest'
import {
  concatArgs,
  concatListContent,
  estimateOutputBytes,
  estimateSeconds,
  formatEstimate,
  outputFileName,
  planSegments,
  segmentArgs,
  segmentRatio,
  weightedProgress,
} from './plan'

const clip = (id: string, start: number, end: number) => ({ id, start, end })

describe('planSegments', () => {
  it('merges overlapping clips and sorts by start', () => {
    expect(planSegments([clip('c', 20, 25), clip('a', 2, 6), clip('b', 4, 9)])).toEqual([
      { start: 2, end: 9 },
      { start: 20, end: 25 },
    ])
  })

  it('returns nothing for no clips', () => {
    expect(planSegments([])).toEqual([])
  })
})

describe('segmentArgs', () => {
  const seg = { start: 1.5, end: 12.25 }

  it('stream copies in fast mode', () => {
    expect(segmentArgs('fast', seg, 0, '/in/game.mp4')).toEqual([
      '-ss',
      '1.500',
      '-to',
      '12.250',
      '-i',
      '/in/game.mp4',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      'seg0.mp4',
    ])
  })

  it('re-encodes in precise mode', () => {
    expect(segmentArgs('precise', seg, 3, '/in/game.mp4')).toEqual([
      '-ss',
      '1.500',
      '-to',
      '12.250',
      '-i',
      '/in/game.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      'seg3.mp4',
    ])
  })
})

describe('concat', () => {
  it('lists every segment file in order', () => {
    expect(concatListContent(3)).toBe("file 'seg0.mp4'\nfile 'seg1.mp4'\nfile 'seg2.mp4'\n")
  })

  it('uses the concat demuxer with stream copy', () => {
    expect(concatArgs('out.mp4')).toEqual([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'list.txt',
      '-c',
      'copy',
      'out.mp4',
    ])
  })
})

describe('outputFileName', () => {
  it('replaces the extension', () => {
    expect(outputFileName('Game 3.MOV')).toBe('Game 3-highlights.mp4')
  })

  it('only strips the last extension', () => {
    expect(outputFileName('finals.day1.mp4')).toBe('finals.day1-highlights.mp4')
  })

  it('handles names without an extension', () => {
    expect(outputFileName('recording')).toBe('recording-highlights.mp4')
  })
})

describe('estimateOutputBytes', () => {
  it('scales the source bitrate by the selected duration', () => {
    const segments = [
      { start: 0, end: 10 },
      { start: 50, end: 60 },
    ]
    expect(estimateOutputBytes(segments, 1_000_000, 100)).toBe(200_000)
  })

  it('is zero before the duration is known', () => {
    expect(estimateOutputBytes([{ start: 0, end: 10 }], 1_000_000, 0)).toBe(0)
  })
})

describe('estimateSeconds', () => {
  const segments = [{ start: 0, end: 30 }]

  it('assumes 0.15x realtime for precise before a rate is measured', () => {
    expect(estimateSeconds('precise', segments)).toBeCloseTo(200)
  })

  it('uses a measured rate', () => {
    expect(estimateSeconds('precise', segments, 0.5)).toBe(60)
  })

  it('falls back to the default for an unusable rate', () => {
    expect(estimateSeconds('fast', segments, 0)).toBe(1.5)
  })
})

describe('formatEstimate', () => {
  it('rounds to whole minutes', () => {
    expect(formatEstimate(30)).toBe('under a minute')
    expect(formatEstimate(80)).toBe('about 1 minute')
    expect(formatEstimate(200)).toBe('about 3 minutes')
  })
})

describe('segmentRatio', () => {
  const seg = { start: 10, end: 20 }

  it('converts microseconds written to a fraction of the segment', () => {
    expect(segmentRatio(2_500_000, seg)).toBe(0.25)
  })

  it('clamps to 0..1', () => {
    expect(segmentRatio(-5, seg)).toBe(0)
    expect(segmentRatio(50_000_000, seg)).toBe(1)
  })
})

describe('weightedProgress', () => {
  const segments = [
    { start: 0, end: 10 },
    { start: 20, end: 50 },
  ]

  it('weights each segment by its duration', () => {
    expect(weightedProgress(segments, 0, 0.5)).toBeCloseTo(0.125)
    expect(weightedProgress(segments, 1, 0)).toBeCloseTo(0.25)
    expect(weightedProgress(segments, 1, 0.5)).toBeCloseTo(0.625)
  })

  it('is complete past the last segment', () => {
    expect(weightedProgress(segments, 2, 0)).toBe(1)
  })

  it('clamps the ratio', () => {
    expect(weightedProgress(segments, 0, 2)).toBeCloseTo(0.25)
  })

  it('is zero with nothing to render', () => {
    expect(weightedProgress([], 0, 1)).toBe(0)
  })
})

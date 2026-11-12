import { describe, expect, it } from 'vitest'
import {
  concatArgs,
  concatDurations,
  concatListContent,
  estimateOutputBytes,
  estimateSeconds,
  formatEstimate,
  inputPath,
  mountPoint,
  outputFileName,
  parseProbe,
  planSegments,
  probeArgs,
  segmentArgs,
  segmentRatio,
} from './plan'

const clip = (id: string, start: number, end: number, sourceId = 'a') => ({
  id,
  sourceId,
  start,
  end,
})

describe('planSegments', () => {
  it('merges overlapping clips and sorts by start', () => {
    expect(planSegments([clip('c', 20, 25), clip('a', 2, 6), clip('b', 4, 9)], ['a'])).toEqual([
      { sourceIndex: 0, start: 2, end: 9 },
      { sourceIndex: 0, start: 20, end: 25 },
    ])
  })

  it('orders segments by source, merging overlaps only within a source', () => {
    const clips = [clip('1', 0, 5, 'a'), clip('2', 3, 8, 'b'), clip('3', 4, 6, 'a')]
    expect(planSegments(clips, ['b', 'a'])).toEqual([
      { sourceIndex: 0, start: 3, end: 8 },
      { sourceIndex: 1, start: 0, end: 6 },
    ])
  })

  it('skips clips of sources that are not listed', () => {
    expect(planSegments([clip('1', 0, 5, 'gone')], ['a'])).toEqual([])
  })

  it('returns nothing for no clips', () => {
    expect(planSegments([], ['a'])).toEqual([])
  })
})

describe('inputs', () => {
  it('mounts each source at its own directory', () => {
    expect(mountPoint(0)).toBe('/in0')
    expect(inputPath(2, 'court 2.mov')).toBe('/in2/court 2.mov')
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

  it('re-encodes in precise mode with capped threads, keeping the source frame timing', () => {
    expect(segmentArgs('precise', seg, 3, '/in/game.mp4')).toEqual([
      '-threads',
      '4',
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
      '-threads',
      '4',
      '-fps_mode',
      'passthrough',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      'seg3.mp4',
    ])
  })
})

describe('concat', () => {
  it('lists every segment file in order, each with its duration to three decimals', () => {
    expect(concatListContent([12.3, 6.0333333, 4.8])).toBe(
      "file 'seg0.mp4'\nduration 12.300\nfile 'seg1.mp4'\nduration 6.033\nfile 'seg2.mp4'\nduration 4.800\n",
    )
  })

  it('leaves out the duration of an entry that has none', () => {
    expect(concatListContent([null, 6, null])).toBe(
      "file 'seg0.mp4'\nfile 'seg1.mp4'\nduration 6.000\nfile 'seg2.mp4'\n",
    )
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
      { sourceIndex: 0, start: 0, end: 10 },
      { sourceIndex: 0, start: 50, end: 60 },
    ]
    expect(estimateOutputBytes(segments, [{ size: 1_000_000, duration: 100 }])).toBe(200_000)
  })

  it('sums each segment at its own source bitrate', () => {
    const segments = [
      { sourceIndex: 0, start: 0, end: 10 },
      { sourceIndex: 1, start: 0, end: 10 },
    ]
    const sources = [
      { size: 1_000_000, duration: 100 },
      { size: 4_000_000, duration: 100 },
    ]
    expect(estimateOutputBytes(segments, sources)).toBe(500_000)
  })

  it('skips sources whose duration is unknown', () => {
    const segments = [{ sourceIndex: 0, start: 0, end: 10 }]
    expect(estimateOutputBytes(segments, [{ size: 1_000_000, duration: 0 }])).toBe(0)
  })
})

describe('estimateSeconds', () => {
  const segments = [
    { sourceIndex: 0, start: 0, end: 20 },
    { sourceIndex: 1, start: 0, end: 10 },
  ]

  it('assumes 0.15x realtime for precise before a rate is measured, over all segments', () => {
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

describe('segment probe', () => {
  it('asks ffprobe for the container start and the video start and length as JSON', () => {
    expect(probeArgs(2)).toEqual([
      ...[
        '-v',
        'error',
        '-show_entries',
        'format=start_time:stream=codec_type,start_time,duration',
      ],
      ...['-of', 'json', 'seg2.mp4', '-o', 'probe.json'],
    ])
  })

  it('reads the video stream and the container start from the JSON', () => {
    const json = JSON.stringify({
      programs: [],
      streams: [
        { codec_type: 'audio', start_time: '0.000000', duration: '12.353016' },
        { codec_type: 'video', start_time: '0.030013', duration: '12.300000' },
      ],
      format: { start_time: '0.000000' },
    })
    expect(parseProbe(json)).toEqual({
      containerStart: 0,
      videoStart: 0.030013,
      videoDuration: 12.3,
    })
  })

  it('gives null for output it cannot use', () => {
    const audioOnly = { streams: [{ codec_type: 'audio', start_time: '0', duration: '3' }] }
    const noStart = {
      streams: [{ codec_type: 'video', start_time: 'N/A', duration: '3' }],
      format: { start_time: '0' },
    }
    const empty = {
      streams: [{ codec_type: 'video', start_time: '0', duration: '0' }],
      format: { start_time: '0' },
    }
    expect(parseProbe('')).toBeNull()
    expect(parseProbe('{"streams": [')).toBeNull()
    expect(parseProbe(JSON.stringify(audioOnly))).toBeNull()
    expect(parseProbe(JSON.stringify(noStart))).toBeNull()
    expect(parseProbe(JSON.stringify(empty))).toBeNull()
  })
})

describe('concatDurations', () => {
  const timing = (containerStart: number, videoStart: number, videoDuration: number) => ({
    containerStart,
    videoStart,
    videoDuration,
  })

  it('places each next video one video length after this one starts', () => {
    // Video leads of 30 ms and 10 ms over the audio: the first entry is 20 ms longer than its
    // video so that the second video starts right after it.
    const durations = concatDurations([timing(0, 0.03, 10.3), timing(0, 0.01, 30.2)])
    expect(durations[0]).toBeCloseTo(10.32, 9)
    expect(durations[1]).toBeCloseTo(30.2, 9)
  })

  it('counts leads from the container start, which is the audio start when audio leads', () => {
    // Precise segments: video always at 0.066 s, audio from 0.043 s or 0.010 s.
    const durations = concatDurations([timing(0.043, 0.066, 6), timing(0.01, 0.066, 6)])
    expect(durations[0]).toBeCloseTo(5.967, 9)
  })

  it('uses the probed video length for a clip that is not a whole number of frames', () => {
    // A 4.79 s Precise clip at 30 fps holds 144 frames, so its video runs 4.800 s, not 4.79.
    const durations = concatDurations([timing(0.01, 0.066, 4.8), timing(0.01, 0.066, 6)])
    expect(durations[0]).toBeCloseTo(4.8, 9)
  })

  it('gives the last entry its own video length', () => {
    expect(concatDurations([timing(0, 0.02, 5), timing(0.01, 0.04, 7)])[1]).toBeCloseTo(7, 9)
  })

  it('gives null for an unprobed entry and uses its own lead before one', () => {
    expect(concatDurations([timing(0, 0.03, 5), null, timing(0, 0.01, 4)])).toEqual([5, null, 4])
  })

  it('gives null rather than a duration that is not positive', () => {
    expect(concatDurations([timing(0, 0, 0.01), timing(0, 0.5, 2)])).toEqual([null, 2])
  })
})

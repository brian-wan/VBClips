import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from '../persistence'
import {
  ASSUMED_DOWNLOAD_BYTES,
  DEFAULT_RATES,
  FALLBACK_LABEL,
  JoinProgress,
  RATES_KEY,
  downloadLabel,
  loadRates,
  percentOf,
  remainingLabel,
  saveRates,
  type JoinProgressOptions,
  type Rates,
} from './progress'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
}

const model = (options: Partial<JoinProgressOptions> = {}) =>
  new JoinProgress({
    segments: [{ start: 0, end: 60 }],
    mode: 'precise',
    outputBytes: 0,
    rates: DEFAULT_RATES,
    startedAt: 0,
    ...options,
  })

describe('loadRates and saveRates', () => {
  it('starts from the defaults', () => {
    expect(loadRates(memoryStore())).toEqual({
      fast: 20,
      precise: 0.15,
      concat: 40,
      download: 5e6,
      stage: 500e6,
    })
    expect(loadRates(null)).toEqual(DEFAULT_RATES)
  })

  it('round-trips learned rates through storage under one key', () => {
    const store = memoryStore()
    saveRates(store, { precise: 1.8 })
    saveRates(store, { download: 42e6 })
    saveRates(store, { stage: 800e6 })
    expect(JSON.parse(store.data.get(RATES_KEY) ?? '')).toEqual({
      version: 1,
      fast: 20,
      precise: 1.8,
      concat: 40,
      download: 42e6,
      stage: 800e6,
    })
    expect(loadRates(store)).toEqual({
      fast: 20,
      precise: 1.8,
      concat: 40,
      download: 42e6,
      stage: 800e6,
    })
  })

  it('reads rates stored before the stage rate existed', () => {
    const store = memoryStore()
    store.setItem(RATES_KEY, JSON.stringify({ version: 1, fast: 30, precise: 1, concat: 50 }))
    expect(loadRates(store)).toMatchObject({ fast: 30, stage: 500e6 })
  })

  it('ignores broken, foreign and non-positive values', () => {
    const store = memoryStore()
    store.setItem(RATES_KEY, '{nope')
    expect(loadRates(store)).toEqual(DEFAULT_RATES)
    store.setItem(RATES_KEY, JSON.stringify({ version: 2, precise: 3 }))
    expect(loadRates(store)).toEqual(DEFAULT_RATES)
    store.setItem(RATES_KEY, JSON.stringify({ version: 1, precise: -1, fast: 'x', concat: 50 }))
    expect(loadRates(store)).toEqual({ ...DEFAULT_RATES, concat: 50 })
    saveRates(store, { fast: Number.NaN })
    expect(loadRates(store).fast).toBe(20)
  })
})

describe('JoinProgress weighting', () => {
  it('gives a 30 MB download at 5 MB/s about 1.5% next to 60 s of Precise', () => {
    const progress = model()
    progress.download(30e6, 30e6, 0)
    // 6 s of download against 400 s of encoding and 1.5 s of concat.
    expect(progress.view().progress).toBeCloseTo(6 / 407.5, 6)
    expect(progress.view().progress).toBeGreaterThan(0.014)
    expect(progress.view().progress).toBeLessThan(0.016)
  })

  it('weights segments by expected time and counts the save at 200 MB/s', () => {
    const progress = model({
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 50 },
      ],
      mode: 'fast',
      outputBytes: 200e6,
    })
    // Expected: cuts 0.5 s + 1.5 s, concat 1 s, save 1 s.
    progress.cut(0, 0.5, 0)
    expect(progress.view().progress).toBeCloseTo(0.25 / 4)
    progress.cut(1, 0, 100)
    expect(progress.view().progress).toBeCloseTo(0.5 / 4)
    progress.concat(0.5, 200)
    expect(progress.view().progress).toBeCloseTo(2.5 / 4)
    progress.save(300)
    expect(progress.view().progress).toBeCloseTo(3 / 4)
  })

  it('treats an unknown download size as 31 MB and shows the bytes received', () => {
    const progress = model()
    progress.download(12.3e6, null, 0)
    expect(progress.view().label).toBe('Downloading ffmpeg · 12.3 MB')
    const expected = 12.3e6 / 5e6 / (ASSUMED_DOWNLOAD_BYTES / 5e6 + 400 + 1.5)
    expect(progress.view().progress).toBeCloseTo(expected, 6)
  })

  it('has no download share when the core is already loaded', () => {
    const progress = model()
    progress.cut(0, 0.5, 0)
    expect(progress.view().progress).toBeCloseTo(200 / 401.5, 6)
  })
})

describe('JoinProgress percent', () => {
  it('never goes backwards when a measured rate makes the job look longer', () => {
    const progress = model()
    progress.download(30e6, 30e6, 0)
    progress.cut(0, 0, 0)
    progress.cut(0, 0.1, 2000)
    const before = progress.view().progress
    expect(before).toBeCloseTo((6 + 40) / 407.5, 6)
    // 0.6 s of video in a minute: the encode is far slower than the stored 0.15.
    progress.cut(0, 0.11, 62000)
    expect(progress.rate('precise')).toBeCloseTo(0.01)
    expect(progress.view().progress).toBe(before)
    progress.cut(0, 0.5, 70000)
    expect(progress.view().progress).toBeGreaterThan(before)
  })

  it('reads 100 only once the output exists', () => {
    const progress = model()
    progress.cut(0, 1, 0)
    progress.concat(1, 0)
    progress.save(0)
    expect(percentOf(progress.view().progress)).toBe(99)
    progress.finish('game-highlights.mp4', 0)
    expect(percentOf(progress.view().progress)).toBe(100)
    expect(progress.view()).toMatchObject({ stage: 'done', label: 'Saved game-highlights.mp4' })
  })

  it('restarts at the end of the download share on the Fast-to-Precise fallback', () => {
    const progress = model({
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 50 },
      ],
      mode: 'fast',
    })
    progress.download(30e6, 30e6, 0)
    progress.cut(0, 1, 0)
    progress.cut(1, 1, 0)
    progress.concat(0.9, 0)
    expect(progress.view().progress).toBeGreaterThan(0.5)

    progress.fallback(0)
    // Download 6 s; re-encoding 40 s at 0.15 is 266.7 s; concat 1 s.
    expect(progress.view().progress).toBeCloseTo(6 / (6 + 40 / 0.15 + 1), 6)
    expect(progress.view().label).toBe(FALLBACK_LABEL)
    progress.cut(0, 0.5, 0)
    expect(progress.view().label).toBe('Switched to Precise: re-encoding clip 1 of 2')
    expect(progress.view().progress).toBeCloseTo((6 + 5 / 0.15) / (6 + 40 / 0.15 + 1), 6)
  })

  it('keeps the staged share on the fallback', () => {
    const progress = model({ segments: [{ start: 0, end: 10 }], mode: 'fast' })
    progress.stage(1e9, 1e9, 0)
    progress.cut(0, 1, 0)
    progress.concat(1, 0)
    progress.fallback(0)
    // Staging 2 s at 500 MB/s; re-encoding 10 s at 0.15 is 66.7 s; concat 0.25 s.
    expect(progress.view().progress).toBeCloseTo(2 / (2 + 10 / 0.15 + 0.25), 6)
  })
})

describe('JoinProgress stage', () => {
  it('weights the copy by bytes at 500 MB/s and labels it', () => {
    const progress = model({ segments: [{ start: 0, end: 20 }], mode: 'fast' })
    progress.stage(1.2e9, 4e9, 0)
    // Staging 8 s; cutting 20 s at 20 is 1 s; concat 0.5 s.
    expect(progress.view()).toMatchObject({
      stage: 'stage',
      label: 'Preparing video · 1.2 of 4.0 GB',
    })
    expect(progress.view().progress).toBeCloseTo(2.4 / (8 + 1 + 0.5), 6)
    progress.cut(0, 0, 0)
    expect(progress.view().progress).toBeCloseTo(8 / (8 + 1 + 0.5), 6)
  })

  it('times the copy from its first chunk, with no warm-up, and learns it when cutting starts', () => {
    const learned: Partial<Rates>[] = []
    const progress = model({
      segments: [{ start: 0, end: 20 }],
      mode: 'fast',
      onLearn: (rates) => learned.push(rates),
    })
    progress.stage(0, 2e9, 0)
    progress.stage(100e6, 2e9, 100)
    progress.stage(2e9, 2e9, 2600)
    // Mounting takes a while: it is not copy time.
    progress.cut(0, 0, 9000)
    expect(learned).toEqual([{ stage: 1.9e9 / 2.5 }])
  })

  it('has no share when nothing needed copying', () => {
    const progress = model({ segments: [{ start: 0, end: 20 }], mode: 'fast' })
    progress.cut(0, 0.5, 0)
    expect(progress.view().progress).toBeCloseTo(0.5 / 1.5, 6)
  })
})

describe('JoinProgress learned rates', () => {
  it('measures each phase after its warm-up and reports it when the phase ends', () => {
    const learned: Partial<Rates>[] = []
    const progress = model({
      segments: [
        { start: 0, end: 20 },
        { start: 30, end: 50 },
      ],
      onLearn: (rates) => learned.push(rates),
    })
    progress.download(1e6, 31e6, 0)
    progress.download(21e6, 31e6, 1000)
    progress.download(31e6, 31e6, 1500)
    expect(progress.rate('download')).toBeCloseTo(20e6)
    progress.cut(0, 0, 1500)
    expect(learned).toEqual([{ download: 20e6 }])

    // 2 media seconds per second, timed from 2 s into the cut phase.
    for (let t = 0; t <= 20; t++) progress.cut(0, (t * 2) / 20, 1500 + t * 1000)
    progress.cut(1, 0, 11500)
    for (let t = 0; t <= 10; t++) progress.cut(1, (t * 2) / 20, 11500 + t * 1000)
    expect(progress.rate('precise')).toBeCloseTo(2)
    progress.concat(0, 21500)
    expect(learned).toEqual([{ download: 20e6 }, { precise: 2 }])
  })

  it('times the download from its first chunk to its last, not to the core start', () => {
    const learned: Partial<Rates>[] = []
    const progress = model({ onLearn: (rates) => learned.push(rates) })
    progress.download(1e6, 31e6, 0)
    progress.download(21e6, 31e6, 1000)
    progress.download(31e6, 31e6, 1500)
    progress.start(1500)
    // The multi-thread core takes 8 s to give up; that is not download time.
    progress.tick(5000)
    progress.cut(0, 0, 9500)
    expect(learned).toEqual([{ download: 20e6 }])
  })

  it('learns nothing from a phase shorter than the warm-up', () => {
    const learned: Partial<Rates>[] = []
    const progress = model({ mode: 'fast', onLearn: (rates) => learned.push(rates) })
    progress.cut(0, 0.5, 0)
    progress.cut(0, 1, 1500)
    progress.concat(1, 1800)
    progress.save(1900)
    progress.finish('out.mp4', 2000)
    expect(learned).toEqual([])
  })
})

describe('JoinProgress remaining time', () => {
  it('says nothing for the first 3 s, then smooths with factor 0.3', () => {
    const progress = model({
      segments: [{ start: 0, end: 100 }],
      rates: { ...DEFAULT_RATES, precise: 1 },
    })
    progress.cut(0, 0, 0)
    progress.cut(0, 0.05, 2500)
    expect(progress.snapshot().remainingSeconds).toBeNull()
    // Base sample at 2.5 s (5 s done); no rate measured yet, so the stored 1x applies.
    progress.cut(0, 0.1, 3000)
    // Measured 5 media s in 0.5 s is too short a sample; 90 s at 1x plus 2.5 s of concat.
    expect(progress.snapshot().remainingSeconds).toBeCloseTo(92.5)
    // Two model changes between shown updates step the average once.
    progress.cut(0, 0.15, 3200)
    progress.cut(0, 0.2, 3500)
    // 15 s in 1 s: 80 s at 15x plus 2.5 s of concat is 7.83 s.
    const raw = 80 / 15 + 2.5
    const once = 92.5 + 0.3 * (raw - 92.5)
    expect(progress.snapshot().remainingSeconds).toBeCloseTo(once)
    expect(progress.view().remainingSeconds).toBeCloseTo(once)
    expect(progress.snapshot().remainingSeconds).toBeCloseTo(once + 0.3 * (raw - once))
  })
})

describe('labels', () => {
  it('names each phase', () => {
    const progress = model({
      segments: Array.from({ length: 12 }, (_, i) => ({ start: i * 10, end: i * 10 + 5 })),
    })
    expect(progress.view().label).toBe('Loading ffmpeg')
    progress.download(12.3e6, 31.5e6, 0)
    expect(progress.view()).toMatchObject({
      stage: 'download',
      label: 'Downloading ffmpeg · 12.3 of 31.5 MB',
    })
    progress.download(31.5e6, 31.5e6, 0)
    progress.start(0)
    expect(progress.view()).toMatchObject({ stage: 'start', label: 'Starting ffmpeg' })
    progress.cut(2, 0, 0)
    expect(progress.view()).toMatchObject({ stage: 'cut', label: 'Cutting clip 3 of 12' })
    progress.concat(0, 0)
    expect(progress.view()).toMatchObject({ stage: 'concat', label: 'Combining clips' })
    progress.save(0)
    expect(progress.view()).toMatchObject({ stage: 'save', label: 'Saving' })
  })

  it('formats download bytes and the time left', () => {
    expect(downloadLabel(0, 32.85e6)).toBe('Downloading ffmpeg · 0.0 of 32.9 MB')
    expect(downloadLabel(5e6, null)).toBe('Downloading ffmpeg · 5.0 MB')
    expect(remainingLabel(null)).toBe('Estimating…')
    expect(remainingLabel(59)).toBe('under a minute left')
    expect(remainingLabel(60)).toBe('about 1 min left')
    expect(remainingLabel(89)).toBe('about 1 min left')
    expect(remainingLabel(240)).toBe('about 4 min left')
  })
})

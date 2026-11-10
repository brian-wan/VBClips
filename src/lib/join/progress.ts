import type { KeyValueStore } from '../persistence'
import type { Span } from '../clips'
import { DEFAULT_RATE, type JoinMode } from './plan'

/**
 * Work per wall-clock second: output media seconds for `fast`, `precise` and `concat`, bytes for
 * `download`.
 */
export type Rates = { fast: number; precise: number; concat: number; download: number }
export type RateKey = keyof Rates

export const DEFAULT_RATES: Rates = { ...DEFAULT_RATE, concat: 40, download: 5e6 }
export const RATES_KEY = 'vbclipper:join-rates'
/** Reading the output out of MEMFS into a Blob. Never learned. */
export const SAVE_BYTES_PER_SECOND = 200e6
/** Download work when the server sends no Content-Length. */
export const ASSUMED_DOWNLOAD_BYTES = 31e6

/** Rate measurements skip the start of a phase, where ffmpeg is still starting up. */
const WARM_UP_MS = 2000
/** A measured rate replaces the stored one once it covers this much wall time. */
const MIN_SAMPLE_MS = 1000
/** The remaining time reads "Estimating…" until the run has this much history. */
const ESTIMATE_AFTER_MS = 3000
const SMOOTHING = 0.3
/** The bar stops short of full until the Blob exists. */
const BEFORE_DONE = 0.999

const isRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export function loadRates(store: KeyValueStore | null): Rates {
  try {
    const raw = store?.getItem(RATES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return { ...DEFAULT_RATES }
    }
    const stored = parsed as Record<RateKey, unknown>
    const pick = (key: RateKey) => (isRate(stored[key]) ? stored[key] : DEFAULT_RATES[key])
    return {
      fast: pick('fast'),
      precise: pick('precise'),
      concat: pick('concat'),
      download: pick('download'),
    }
  } catch {
    return { ...DEFAULT_RATES }
  }
}

/** Merges newly measured rates into the stored ones. */
export function saveRates(store: KeyValueStore | null, learned: Partial<Rates>): void {
  if (!store) return
  const rates = { ...loadRates(store) }
  for (const key of Object.keys(learned) as RateKey[]) {
    const value = learned[key]
    if (isRate(value)) rates[key] = value
  }
  try {
    store.setItem(RATES_KEY, JSON.stringify({ version: 1, ...rates }))
  } catch {
    // Storage full or blocked: the next join starts from the defaults again.
  }
}

export type JoinStage = 'download' | 'cut' | 'concat' | 'save' | 'done'

/** `key` null means the fixed save rate. */
type Entry = { stage: JoinStage; work: number; done: number; key: RateKey | null }
type Sample = { work: number; at: number }
type Meter = { start: number; base: Sample | null; last: Sample | null }

export type ProgressView = {
  stage: JoinStage
  /** Overall 0..1, each phase weighted by its expected time. */
  progress: number
  remainingSeconds: number | null
  label: string
}

export type JoinProgressOptions = {
  segments: readonly Span[]
  mode: JoinMode
  /** Estimated output size, the work of the save phase. */
  outputBytes: number
  rates: Rates
  startedAt: number
  /** Called with a phase's measured rate when the phase finishes. */
  onLearn?: (rates: Partial<Rates>) => void
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1)

export function downloadLabel(received: number, total: number | null): string {
  return total === null
    ? `Downloading ffmpeg · ${megabytes(received)} MB`
    : `Downloading ffmpeg · ${megabytes(received)} of ${megabytes(total)} MB`
}

export function remainingLabel(seconds: number | null): string {
  if (seconds === null) return 'Estimating…'
  if (seconds < 60) return 'under a minute left'
  return `about ${Math.round(seconds / 60)} min left`
}

/** What the dialog prints next to the bar. */
export function percentOf(progress: number): number {
  return Math.floor(Math.min(Math.max(progress, 0), 1) * 100)
}

export const LOADING_LABEL = 'Loading ffmpeg'
export const FALLBACK_LABEL = 'Switched to Precise: re-encoding'

/**
 * The join as a list of phases (download, one cut per segment, concat, save), each with an
 * amount of work and a rate that turns it into expected seconds. Rates start from the stored
 * ones and are replaced by live measurements as each phase runs. Pure: the caller passes the
 * clock in.
 */
export class JoinProgress {
  private readonly entries: Entry[]
  private readonly segmentCount: number
  private readonly rates: Rates
  private readonly startedAt: number
  private readonly onLearn?: (rates: Partial<Rates>) => void
  private readonly meters = new Map<RateKey, Meter>()
  private current = 0
  private shown = 0
  private smoothed: number | null = null
  private label = LOADING_LABEL
  private fellBack = false
  private finished = false

  constructor({ segments, mode, outputBytes, rates, startedAt, onLearn }: JoinProgressOptions) {
    this.rates = { ...rates }
    this.startedAt = startedAt
    this.onLearn = onLearn
    this.segmentCount = segments.length
    const outputSeconds = segments.reduce((sum, s) => sum + Math.max(s.end - s.start, 0), 0)
    this.entries = [
      { stage: 'download', work: 0, done: 0, key: 'download' },
      ...segments.map((s): Entry => ({
        stage: 'cut',
        work: Math.max(s.end - s.start, 0),
        done: 0,
        key: mode,
      })),
      { stage: 'concat', work: outputSeconds, done: 0, key: 'concat' },
      { stage: 'save', work: Math.max(outputBytes, 0), done: 0, key: null },
    ]
  }

  /** Core download: bytes so far and the total, or null when the server did not say. */
  download(received: number, total: number | null, now: number): void {
    const entry = this.entries[0]
    entry.work = total ?? Math.max(ASSUMED_DOWNLOAD_BYTES, received)
    entry.done = Math.min(received, entry.work)
    this.label = downloadLabel(received, total)
    this.measure('download', now)
    this.update(now)
  }

  /** Segment `index` is `ratio` written. */
  cut(index: number, ratio: number, now: number): void {
    const position = 1 + index
    this.enter(position, now)
    const entry = this.entries[position]
    entry.done = entry.work * clamp01(ratio)
    const clip = `clip ${index + 1} of ${this.segmentCount}`
    this.label = this.fellBack ? `${FALLBACK_LABEL} ${clip}` : `Cutting ${clip}`
    this.measure(entry.key as RateKey, now)
    this.update(now)
  }

  concat(ratio: number, now: number): void {
    const position = this.entries.length - 2
    this.enter(position, now)
    const entry = this.entries[position]
    entry.done = entry.work * clamp01(ratio)
    this.label = 'Combining clips'
    this.measure('concat', now)
    this.update(now)
  }

  save(now: number): void {
    this.enter(this.entries.length - 1, now)
    this.label = 'Saving'
    this.update(now)
  }

  finish(name: string, now: number): void {
    this.enter(this.entries.length, now)
    this.finished = true
    this.shown = 1
    this.smoothed = 0
    this.label = `Saved ${name}`
  }

  /**
   * Fast concat failed: every segment is cut again with Precise. The bar goes back to the end of
   * the download share, the one time it moves backwards.
   */
  fallback(now: number): void {
    this.fellBack = true
    this.meters.delete('concat')
    this.meters.delete('precise')
    for (const entry of this.entries.slice(1)) {
      entry.done = 0
      if (entry.stage === 'cut') entry.key = 'precise'
    }
    this.current = 1
    this.shown = 0
    this.smoothed = null
    this.label = FALLBACK_LABEL
    this.update(now)
  }

  view(): ProgressView {
    return {
      stage: this.finished ? 'done' : this.stageAt(this.current),
      progress: this.shown,
      remainingSeconds: this.smoothed,
      label: this.label,
    }
  }

  /** The rate in use for `key`: measured in this run when there is enough data, else stored. */
  rate(key: RateKey | null): number {
    if (key === null) return SAVE_BYTES_PER_SECOND
    return this.measured(key) ?? this.rates[key]
  }

  private stageAt(position: number): JoinStage {
    return this.entries[position]?.stage ?? 'done'
  }

  /** Moves to entry `position`, completing the ones before it. */
  private enter(position: number, now: number): void {
    if (position <= this.current) return
    for (let i = this.current; i < position && i < this.entries.length; i++) {
      const entry = this.entries[i]
      entry.done = entry.work
      if (entry.key) this.measure(entry.key, now)
      const next = this.entries[i + 1]
      if (entry.key && entry.key !== next?.key) this.learn(entry.key)
    }
    this.current = position
    const key = this.entries[position]?.key
    if (key && !this.meters.has(key)) this.meters.set(key, { start: now, base: null, last: null })
  }

  private workDone(key: RateKey): number {
    return this.entries.reduce((sum, e) => (e.key === key ? sum + e.done : sum), 0)
  }

  private measure(key: RateKey, now: number): void {
    let meter = this.meters.get(key)
    if (!meter) {
      meter = { start: now, base: null, last: null }
      this.meters.set(key, meter)
    }
    const sample = { work: this.workDone(key), at: now }
    // The download is timed from its first chunk; the others skip their warm-up.
    const ready = key === 'download' ? sample.work > 0 : now - meter.start >= WARM_UP_MS
    if (!meter.base) {
      if (ready) meter.base = sample
      return
    }
    meter.last = sample
  }

  private measured(key: RateKey): number | null {
    const meter = this.meters.get(key)
    if (!meter?.base || !meter.last) return null
    const seconds = (meter.last.at - meter.base.at) / 1000
    const work = meter.last.work - meter.base.work
    if (seconds * 1000 < MIN_SAMPLE_MS || !(work > 0)) return null
    return work / seconds
  }

  private learn(key: RateKey): void {
    const rate = this.measured(key)
    if (rate === null) return
    this.rates[key] = rate
    this.onLearn?.({ [key]: rate })
  }

  private expected(entry: Entry, part: 'work' | 'done'): number {
    const rate = this.rate(entry.key)
    return rate > 0 ? entry[part] / rate : 0
  }

  private totalExpected(): number {
    return this.entries.reduce((sum, e) => sum + this.expected(e, 'work'), 0)
  }

  private update(now: number): void {
    if (this.finished) return
    const total = this.totalExpected()
    const done = this.entries.reduce((sum, e) => sum + this.expected(e, 'done'), 0)
    const fraction = total > 0 ? Math.min(done / total, BEFORE_DONE) : 0
    this.shown = Math.max(this.shown, fraction)
    if (now - this.startedAt < ESTIMATE_AFTER_MS) return
    const raw = Math.max(total - done, 0)
    this.smoothed = this.smoothed === null ? raw : this.smoothed + SMOOTHING * (raw - this.smoothed)
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0
}

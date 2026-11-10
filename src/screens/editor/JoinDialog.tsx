import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedSource } from '../../App'
import { Dialog } from '../../components/Dialog'
import ui from '../../components/ui.module.css'
import { downloadUrl } from '../../download'
import { getFFmpeg } from '../../join/ffmpeg'
import { formatBytes } from '../../lib/bytes'
import type { Clip } from '../../lib/clips'
import {
  LARGE_OUTPUT_BYTES,
  MAX_OUTPUT_BYTES,
  estimateOutputBytes,
  estimateSeconds,
  formatEstimate,
  outputFileName,
  planSegments,
  totalDuration,
  type JoinMode,
} from '../../lib/join/plan'
import { LOADING_LABEL, loadRates, percentOf, remainingLabel } from '../../lib/join/progress'
import {
  FALLBACK_REASON,
  JoinCancelled,
  JoinError,
  runJoin,
  type JoinEvent,
} from '../../lib/join/runner'
import { formatTime } from '../../lib/time'
import { browserStore } from '../../storage'
import styles from './JoinDialog.module.css'

type Props = {
  /** In timeline order. */
  sources: readonly LoadedSource[]
  clips: readonly Clip[]
  onClose: () => void
}

type Result = { url: string; name: string; size: number; fellBack: boolean }
type Failure = { message: string; mode: JoinMode; log: string[] }

type State =
  | { kind: 'setup' }
  | {
      kind: 'running'
      event: JoinEvent
      fellBack: boolean
      startedAt: number
      loadingLog: string | null
    }
  | { kind: 'done'; result: Result }
  | { kind: 'error'; failure: Failure }

const LOG_TAIL = 20

/** Read in event handlers only; React's purity lint cannot tell `start` is one. */
const clock = () => performance.now()

const MODES: { mode: JoinMode; title: string; detail: (estimate: string) => string }[] = [
  {
    mode: 'fast',
    title: 'Fast',
    detail: () =>
      'Exact to the nearest keyframe, usually within a second. Takes seconds. If videos differ, Join switches to Precise automatically.',
  },
  {
    mode: 'precise',
    title: 'Precise',
    detail: (estimate) => `Frame-accurate. Re-encodes the video, so it takes ${estimate}.`,
  },
]

export function JoinDialog({ sources, clips, onClose }: Props) {
  const segments = useMemo(
    () =>
      planSegments(
        clips,
        sources.map((s) => s.meta.id),
      ),
    [clips, sources],
  )
  const files = useMemo(() => sources.map((s) => s.file), [sources])
  const total = totalDuration(segments)
  const estimatedBytes = estimateOutputBytes(
    segments,
    sources.map((s) => s.meta),
  )
  const tooLarge = estimatedBytes > MAX_OUTPUT_BYTES
  const large = !tooLarge && estimatedBytes >= LARGE_OUTPUT_BYTES
  const name = outputFileName(sources[0]?.meta.name ?? 'video')

  const [mode, setMode] = useState<JoinMode>('fast')
  const [state, setState] = useState<State>({ kind: 'setup' })
  const [confirmingStop, setConfirmingStop] = useState<'stop' | 'close' | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => performance.now())
  const [preciseRate] = useState(() => loadRates(browserStore()).precise)

  const abortRef = useRef<AbortController | null>(null)
  const resultUrl = useRef<string | null>(null)

  const running = state.kind === 'running'

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    },
    [],
  )

  const start = async (joinMode: JoinMode) => {
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = clock()
    setNow(startedAt)
    setConfirmingStop(null)
    setCopied(false)
    let fellBack = false
    let loadingLog: string | null = null
    setState({
      kind: 'running',
      fellBack,
      startedAt,
      loadingLog,
      event: {
        phase: 'download',
        mode: joinMode,
        segmentIndex: 0,
        progress: 0,
        remainingSeconds: null,
        label: LOADING_LABEL,
      },
    })

    const onEvent = (event: JoinEvent) => {
      const loading = event.phase === 'download' || event.phase === 'start'
      if (event.log && loading) loadingLog = event.log
      else if (event.log && event.phase !== 'fallback') return
      if (event.phase === 'fallback') fellBack = true
      setState({ kind: 'running', event, fellBack, startedAt, loadingLog })
    }

    try {
      const blob = await runJoin({
        ffmpeg: getFFmpeg(),
        files,
        segments,
        mode: joinMode,
        outputName: name,
        outputBytes: estimatedBytes,
        store: browserStore(),
        onEvent,
        signal: controller.signal,
      })
      // Stopped or closed as the join finished: no file, no object URL to leak.
      if (controller.signal.aborted) {
        setState({ kind: 'setup' })
        return
      }
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
      const url = URL.createObjectURL(blob)
      resultUrl.current = url
      downloadUrl(url, name)
      setState({ kind: 'done', result: { url, name, size: blob.size, fellBack } })
    } catch (error) {
      if (error instanceof JoinCancelled) {
        setState({ kind: 'setup' })
        return
      }
      const failure =
        error instanceof JoinError
          ? { message: error.message, mode: error.mode, log: error.log }
          : { message: String(error), mode: joinMode, log: [] }
      setState({ kind: 'error', failure })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const stop = () => {
    const closing = confirmingStop === 'close'
    abortRef.current?.abort()
    setConfirmingStop(null)
    if (closing) onClose()
  }

  const requestClose = () => {
    if (running) setConfirmingStop('close')
    else onClose()
  }

  const copyLog = async (log: string[]) => {
    try {
      await navigator.clipboard.writeText(log.join('\n'))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const preciseEstimate = formatEstimate(estimateSeconds('precise', segments, preciseRate))
  const clipWord = clips.length === 1 ? 'clip' : 'clips'
  const summary = `${clips.length} ${clipWord} · ${formatTime(total)} total · about ${formatBytes(estimatedBytes)}`

  return (
    <Dialog title="Join clips" width={520} closeLabel="Close" onClose={requestClose}>
      <div className={styles.content}>
        <p className={styles.summary}>
          {summary}
          {large && (
            <>
              <br />
              Large output: the browser may run out of memory. Precise mode makes a smaller file.
            </>
          )}
        </p>

        {state.kind === 'setup' && (
          <>
            <fieldset className={styles.modes}>
              <legend className={styles.legend}>Mode</legend>
              {MODES.map((m) => (
                <label
                  key={m.mode}
                  className={`${styles.mode} ${mode === m.mode ? styles.modeSelected : ''}`}
                >
                  <input
                    type="radio"
                    name="join-mode"
                    value={m.mode}
                    checked={mode === m.mode}
                    onChange={() => setMode(m.mode)}
                    className={styles.radio}
                  />
                  <span className={styles.radioMark} aria-hidden="true" />
                  <span className={styles.modeText}>
                    <span className={styles.modeTitle}>{m.title}</span>
                    <span className={styles.modeDetail}>{m.detail(preciseEstimate)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {tooLarge && (
              <p className={styles.warning} role="alert">
                The joined video would be about {formatBytes(estimatedBytes)}, over the{' '}
                {formatBytes(MAX_OUTPUT_BYTES)} the browser can assemble in memory. Shorten or
                remove some clips, then join again.
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" className={ui.secondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={ui.primary}
                disabled={tooLarge || segments.length === 0}
                onClick={() => void start(mode)}
              >
                Join {clips.length} {clipWord}
              </button>
            </div>
          </>
        )}

        {state.kind === 'running' && (
          <Progress
            event={state.event}
            elapsed={(now - state.startedAt) / 1000}
            fellBack={state.fellBack}
            loadingLog={state.loadingLog}
            confirmingStop={confirmingStop !== null}
            onStop={() => setConfirmingStop('stop')}
            onConfirmStop={stop}
            onKeepGoing={() => setConfirmingStop(null)}
          />
        )}

        {state.kind === 'done' && (
          <>
            <div className={styles.result}>
              <p className={styles.resultTitle}>Saved {state.result.name}</p>
              <p className={styles.resultDetail}>{formatBytes(state.result.size)}</p>
            </div>
            {state.result.fellBack && <p className={styles.note}>{FALLBACK_REASON}</p>}
            <div className={styles.actions}>
              <button
                type="button"
                className={ui.secondary}
                onClick={() => downloadUrl(state.result.url, state.result.name)}
              >
                Save again
              </button>
              <button type="button" className={ui.primary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <p className={styles.errorMessage} role="alert">
              {state.failure.message} Check the log below, then try again
              {state.failure.mode === 'fast' ? ' or use Precise.' : '.'}
            </p>
            {state.failure.log.length > 0 && (
              <pre className={styles.log}>{state.failure.log.slice(-LOG_TAIL).join('\n')}</pre>
            )}
            <div className={styles.actions}>
              {state.failure.log.length > 0 && (
                <button
                  type="button"
                  className={ui.secondary}
                  onClick={() => void copyLog(state.failure.log)}
                >
                  {copied ? 'Copied' : 'Copy log'}
                </button>
              )}
              <button
                type="button"
                className={state.failure.mode === 'fast' ? ui.secondary : ui.primary}
                onClick={() => setState({ kind: 'setup' })}
              >
                Back
              </button>
              {state.failure.mode === 'fast' && (
                <button
                  type="button"
                  className={ui.primary}
                  onClick={() => {
                    setMode('precise')
                    void start('precise')
                  }}
                >
                  Try Precise
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

type ProgressProps = {
  event: JoinEvent
  elapsed: number
  fellBack: boolean
  loadingLog: string | null
  confirmingStop: boolean
  onStop: () => void
  onConfirmStop: () => void
  onKeepGoing: () => void
}

function Progress({
  event,
  elapsed,
  fellBack,
  loadingLog,
  confirmingStop,
  onStop,
  onConfirmStop,
  onKeepGoing,
}: ProgressProps) {
  const percent = percentOf(event.progress)

  return (
    <>
      {fellBack && <p className={styles.note}>{FALLBACK_REASON}</p>}
      <div className={styles.progress}>
        <div className={styles.progressRow}>
          <span className={styles.label}>{event.label}</span>
          <span className={styles.percent}>{percent}%</span>
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-label="Join progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className={styles.fill} style={{ transform: `scaleX(${event.progress})` }} />
        </div>
        <div className={styles.progressRow}>
          <span className={styles.muted}>{formatTime(elapsed)} elapsed</span>
          <span className={styles.muted}>{remainingLabel(event.remainingSeconds)}</span>
        </div>
        {(event.phase === 'download' || event.phase === 'start') && loadingLog && (
          <span className={styles.loadingLog}>{loadingLog}</span>
        )}
      </div>
      <div className={styles.actions}>
        {confirmingStop ? (
          <>
            <span className={styles.confirm}>Stop joining?</span>
            <button type="button" className={ui.secondary} onClick={onKeepGoing}>
              Keep joining
            </button>
            <button type="button" className={ui.destructive} onClick={onConfirmStop}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className={ui.secondary} onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </>
  )
}

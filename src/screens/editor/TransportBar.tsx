import { useRef, type KeyboardEvent } from 'react'
import {
  Back5,
  ChevronLeft,
  ChevronRight,
  Forward5,
  PauseIcon,
  PlayIcon,
} from '../../components/Icons'
import { Tip } from '../../components/Tip'
import ui from '../../components/ui.module.css'
import { useCoarsePointer } from '../../hooks/useCoarsePointer'
import { SPEEDS } from '../../lib/speed'
import styles from './TransportBar.module.css'

type Props = {
  paused: boolean
  marking: boolean
  clipLabel: string | null
  hasClips: boolean
  speed: number
  onTogglePlay: () => void
  onSeekBy: (seconds: number) => void
  onPrevClip: () => void
  onNextClip: () => void
  onOpenClip: () => void
  onMark: () => void
  onSpeed: (speed: number) => void
  onShowShortcuts: () => void
}

const iconTip = `${ui.iconButton} ${ui.tip}`

/** Arrow keys in the speed group, as in the ARIA radio group pattern. */
const ARROW_STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

export function TransportBar({
  paused,
  marking,
  clipLabel,
  hasClips,
  speed,
  onTogglePlay,
  onSeekBy,
  onPrevClip,
  onNextClip,
  onOpenClip,
  onMark,
  onSpeed,
  onShowShortcuts,
}: Props) {
  const coarse = useCoarsePointer()
  const speedButtons = useRef<(HTMLButtonElement | null)[]>([])
  // The speed group is one tab stop, on the checked segment; arrows move the check and focus.
  const onSpeedKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[e.key]
    if (step === undefined || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    const count = SPEEDS.length
    const index = (SPEEDS.findIndex((s) => s === speed) + step + count) % count
    const next = SPEEDS[index]
    if (next === undefined) return
    onSpeed(next)
    speedButtons.current[index]?.focus()
  }

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <div className={styles.cluster}>
          <button
            type="button"
            className={`${iconTip} ${styles.play}`}
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={onTogglePlay}
          >
            {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
            <Tip label={paused ? 'Play' : 'Pause'} keys={['K']} />
          </button>
          <button
            type="button"
            className={iconTip}
            aria-label="Back 5 seconds"
            onClick={() => onSeekBy(-5)}
          >
            <Back5 size={20} strokeWidth={1.8} />
            <Tip label="Back 5 s" keys={['←']} />
          </button>
          <button
            type="button"
            className={iconTip}
            aria-label="Forward 5 seconds"
            onClick={() => onSeekBy(5)}
          >
            <Forward5 size={20} strokeWidth={1.8} />
            <Tip label="Forward 5 s" keys={['→']} />
          </button>
        </div>
        <div className={styles.clipNav} role="group" aria-label="Clip navigation">
          <button
            type="button"
            className={`${ui.tip} ${ui.touchTarget} ${styles.navArrow}`}
            aria-label="Previous clip"
            disabled={!hasClips}
            onClick={onPrevClip}
          >
            <ChevronLeft size={16} />
            <Tip label="Previous clip" keys={['↑', '[']} />
          </button>
          <button
            type="button"
            className={`${ui.tip} ${ui.touchTarget} ${styles.navLabel}`}
            disabled={!hasClips}
            onClick={onOpenClip}
          >
            {clipLabel ?? 'No clips'}
            <Tip label="Edit this clip" keys={['E']} />
          </button>
          <button
            type="button"
            className={`${ui.tip} ${ui.touchTarget} ${styles.navArrow}`}
            aria-label="Next clip"
            disabled={!hasClips}
            onClick={onNextClip}
          >
            <ChevronRight size={16} />
            <Tip label="Next clip" keys={['↓', ']']} />
          </button>
        </div>
      </div>

      <div className={styles.center}>
        <button
          type="button"
          className={`${ui.tip} ${ui.touchTarget} ${styles.mark} ${marking ? styles.marking : ''}`}
          aria-label={marking ? 'Mark end' : 'Mark start'}
          onClick={onMark}
        >
          <span className={marking ? styles.stop : styles.ring} />
          <Tip label={marking ? 'Mark end' : 'Mark start'} keys={['Space']} />
        </button>
        {coarse ? (
          <span className={styles.caption} aria-hidden="true">
            Mark
          </span>
        ) : (
          <kbd className={ui.kbd} aria-hidden="true">
            Space
          </kbd>
        )}
      </div>

      <div className={`${styles.cluster} ${styles.end}`}>
        <div
          className={styles.segmented}
          role="radiogroup"
          aria-label="Playback speed"
          onKeyDown={onSpeedKey}
        >
          {SPEEDS.map((s, i) => (
            <button
              key={s}
              ref={(el) => {
                speedButtons.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={s === speed}
              tabIndex={s === speed ? 0 : -1}
              className={`${ui.tip} ${ui.touchTarget} ${styles.segment} ${s === speed ? styles.segmentActive : ''}`}
              onClick={() => onSpeed(s)}
            >
              {s}×
              <Tip label={`${s}× speed, cycle with`} keys={['S']} />
            </button>
          ))}
        </div>
        {/* Nothing to list without a keyboard; the ? key still opens it. */}
        {!coarse && (
          <button
            type="button"
            className={`${iconTip} ${ui.tipEnd}`}
            aria-label="Keyboard shortcuts"
            onClick={onShowShortcuts}
          >
            <span className={styles.question}>?</span>
            <Tip label="Keyboard shortcuts" keys={['?']} />
          </button>
        )}
      </div>
    </div>
  )
}

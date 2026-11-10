import {
  Back5,
  ChevronLeft,
  ChevronRight,
  Forward5,
  PauseIcon,
  PlayIcon,
} from '../../components/Icons'
import ui from '../../components/ui.module.css'
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
  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <div className={styles.cluster}>
          <button
            type="button"
            className={`${iconTip} ${styles.play}`}
            aria-label={paused ? 'Play' : 'Pause'}
            data-tip={paused ? 'Play (K)' : 'Pause (K)'}
            onClick={onTogglePlay}
          >
            {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
          </button>
          <button
            type="button"
            className={`${iconTip} ${styles.secondary}`}
            aria-label="Back 5 seconds"
            data-tip="Back 5 s (←)"
            onClick={() => onSeekBy(-5)}
          >
            <Back5 size={24} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`${iconTip} ${styles.secondary}`}
            aria-label="Forward 5 seconds"
            data-tip="Forward 5 s (→)"
            onClick={() => onSeekBy(5)}
          >
            <Forward5 size={24} strokeWidth={1.8} />
          </button>
        </div>
        <div className={styles.clipNav} role="group" aria-label="Clip navigation">
          <button
            type="button"
            className={`${ui.tip} ${styles.navArrow}`}
            aria-label="Previous clip"
            data-tip="Previous clip (↑ or [)"
            disabled={!hasClips}
            onClick={onPrevClip}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className={`${ui.tip} ${styles.navLabel}`}
            data-tip="Edit this clip (E)"
            disabled={!hasClips}
            onClick={onOpenClip}
          >
            {clipLabel ?? 'No clips'}
          </button>
          <button
            type="button"
            className={`${ui.tip} ${styles.navArrow}`}
            aria-label="Next clip"
            data-tip="Next clip (↓ or ])"
            disabled={!hasClips}
            onClick={onNextClip}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className={styles.center}>
        <button
          type="button"
          className={`${ui.tip} ${styles.mark} ${marking ? styles.marking : ''}`}
          aria-label={marking ? 'Mark end' : 'Mark start'}
          data-tip={marking ? 'Mark end (Space)' : 'Mark start (Space)'}
          onClick={onMark}
        >
          <span className={marking ? styles.stop : styles.ring} />
        </button>
        <span className={styles.caption} aria-hidden="true">
          Space
        </span>
      </div>

      <div className={`${styles.cluster} ${styles.end}`}>
        <div className={styles.segmented} role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === speed}
              className={`${ui.tip} ${styles.segment} ${s === speed ? styles.segmentActive : ''}`}
              data-tip={`${s}× speed (S cycles)`}
              onClick={() => onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${iconTip} ${ui.tipEnd} ${styles.secondary}`}
          aria-label="Keyboard shortcuts"
          data-tip="Keyboard shortcuts (?)"
          onClick={onShowShortcuts}
        >
          <span className={styles.question}>?</span>
        </button>
      </div>
    </div>
  )
}

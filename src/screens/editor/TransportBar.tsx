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
            className={`${ui.tip} ${styles.navArrow}`}
            aria-label="Previous clip"
            disabled={!hasClips}
            onClick={onPrevClip}
          >
            <ChevronLeft size={16} />
            <Tip label="Previous clip" keys={['↑', '[']} />
          </button>
          <button
            type="button"
            className={`${ui.tip} ${styles.navLabel}`}
            disabled={!hasClips}
            onClick={onOpenClip}
          >
            {clipLabel ?? 'No clips'}
            <Tip label="Edit this clip" keys={['E']} />
          </button>
          <button
            type="button"
            className={`${ui.tip} ${styles.navArrow}`}
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
          className={`${ui.tip} ${styles.mark} ${marking ? styles.marking : ''}`}
          aria-label={marking ? 'Mark end' : 'Mark start'}
          onClick={onMark}
        >
          <span className={marking ? styles.stop : styles.ring} />
          <Tip label={marking ? 'Mark end' : 'Mark start'} keys={['Space']} />
        </button>
        <kbd className={ui.kbd} aria-hidden="true">
          Space
        </kbd>
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
              onClick={() => onSpeed(s)}
            >
              {s}×
              <Tip label={`${s}× speed, cycle with`} keys={['S']} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${iconTip} ${ui.tipEnd}`}
          aria-label="Keyboard shortcuts"
          onClick={onShowShortcuts}
        >
          <span className={styles.question}>?</span>
          <Tip label="Keyboard shortcuts" keys={['?']} />
        </button>
      </div>
    </div>
  )
}

import { forwardRef } from 'react'
import ui from '../../components/ui.module.css'
import { canSetEnd, canSetStart, clipDuration, roundTime, type Clip } from '../../lib/clips'
import { formatTimePrecise } from '../../lib/time'
import styles from './ClipEditor.module.css'

type Props = {
  clip: Clip
  number: number
  duration: number
  playhead: number
  onChange: (clip: Clip) => void
  onPreview: (clip: Clip) => void
  onDelete: (clip: Clip) => void
}

const NUDGES = [-1, -0.1, 0.1, 1]

const nudgeLabel = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)} s`

/** Selected clip editor pinned to the bottom of the sidebar. Focusable so `E` can jump into it. */
export const ClipEditor = forwardRef<HTMLElement, Props>(function ClipEditor(
  { clip, number, duration, playhead, onChange, onPreview, onDelete },
  ref,
) {
  const edges = [
    {
      label: 'Start',
      value: clip.start,
      valid: (t: number) => canSetStart(clip, t),
      apply: (t: number) => onChange({ ...clip, start: t }),
    },
    {
      label: 'End',
      value: clip.end,
      valid: (t: number) => canSetEnd(clip, t, duration),
      apply: (t: number) => onChange({ ...clip, end: t }),
    },
  ]

  return (
    <section ref={ref} className={styles.card} tabIndex={-1} aria-label={`Edit clip ${number}`}>
      <header className={styles.header}>
        <h3 className={styles.title}>Clip {number}</h3>
        <span className={styles.length}>Length {formatTimePrecise(clipDuration(clip))}</span>
      </header>

      {edges.map((edge) => (
        <div key={edge.label} className={styles.edge}>
          <div className={styles.edgeHeader}>
            <span className={styles.edgeLabel}>{edge.label}</span>
            <span className={styles.edgeValue}>{formatTimePrecise(edge.value)}</span>
            <button
              type="button"
              className={styles.setPlayhead}
              disabled={!edge.valid(playhead)}
              onClick={() => edge.apply(playhead)}
            >
              Set to playhead
            </button>
          </div>
          <div className={styles.nudges}>
            {NUDGES.map((n) => {
              const target = roundTime(edge.value + n)
              return (
                <button
                  key={n}
                  type="button"
                  className={styles.nudge}
                  aria-label={`${edge.label} ${nudgeLabel(n)}`}
                  disabled={!edge.valid(target)}
                  onClick={() => edge.apply(target)}
                >
                  {nudgeLabel(n)}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.pillSecondary} ${styles.action} ${styles.preview}`}
          onClick={() => onPreview(clip)}
        >
          Preview
        </button>
        <button
          type="button"
          className={`${ui.pillDestructive} ${styles.action}`}
          onClick={() => onDelete(clip)}
        >
          Delete clip
        </button>
      </div>
    </section>
  )
})

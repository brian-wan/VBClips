import { Sheet } from '../../components/Sheet'
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
  onClose: () => void
}

const NUDGES = [-1, -0.1, 0.1, 1]

const nudgeLabel = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)} s`

export function ClipEditor({
  clip,
  number,
  duration,
  playhead,
  onChange,
  onPreview,
  onDelete,
  onClose,
}: Props) {
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
    <Sheet title={`Clip ${number}`} onClose={onClose}>
      {edges.map((edge) => (
        <div key={edge.label} className={styles.edge}>
          <div className={styles.edgeHeader}>
            <span className={styles.edgeLabel}>{edge.label}</span>
            <span className={styles.edgeValue}>{formatTimePrecise(edge.value)}</span>
          </div>
          <div className={styles.nudges}>
            {NUDGES.map((n) => {
              const target = roundTime(edge.value + n)
              return (
                <button
                  key={n}
                  type="button"
                  className={styles.nudge}
                  disabled={!edge.valid(target)}
                  onClick={() => edge.apply(target)}
                >
                  {nudgeLabel(n)}
                </button>
              )
            })}
            <button
              type="button"
              className={styles.nudge}
              disabled={!edge.valid(playhead)}
              onClick={() => edge.apply(playhead)}
            >
              Set to playhead
            </button>
          </div>
        </div>
      ))}
      <p className={styles.length}>Length {formatTimePrecise(clipDuration(clip))}</p>
      <div className={styles.actions}>
        <button type="button" className={ui.pillSecondary} onClick={() => onPreview(clip)}>
          Preview
        </button>
        <button type="button" className={ui.pillDestructive} onClick={() => onDelete(clip)}>
          Delete
        </button>
      </div>
    </Sheet>
  )
}

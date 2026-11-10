import { memo, useEffect, useRef } from 'react'
import { Trash } from '../../components/Icons'
import { clipDuration, type Clip } from '../../lib/clips'
import { useCoarsePointer } from '../../hooks/useCoarsePointer'
import { formatTime, formatTimePrecise } from '../../lib/time'
import ui from '../../components/ui.module.css'
import styles from './ClipsList.module.css'

type Props = {
  clips: Clip[]
  overlapping: Set<string>
  selectedId: string | null
  totalClipped: number
  onSelect: (clip: Clip) => void
  onPlay: (clip: Clip) => void
  onDelete: (clip: Clip) => void
}

/** Header and scrolling clip list; the parent grid pins the clip editor under it. */
export const ClipsList = memo(function ClipsList({
  clips,
  overlapping,
  selectedId,
  totalClipped,
  onSelect,
  onPlay,
  onDelete,
}: Props) {
  const coarse = useCoarsePointer()
  const listRef = useRef<HTMLUListElement>(null)
  /** How the latest press on a row came in: a tap on the selected row plays it. */
  const pressedWith = useRef('')

  useEffect(() => {
    if (!selectedId) return
    listRef.current
      ?.querySelector(`[data-clip-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>Clips ({clips.length})</h2>
        <span className={styles.total} title="Total clipped duration, overlaps counted once">
          {formatTime(totalClipped)}
        </span>
      </header>

      {clips.length === 0 ? (
        <p className={styles.empty}>
          {coarse
            ? 'No clips yet. Tap Mark at the start of a point.'
            : 'No clips yet. Press Space to mark the start of a point.'}
        </p>
      ) : (
        <ul ref={listRef} className={styles.list} aria-label="Clips">
          {clips.map((clip, i) => (
            <li
              key={clip.id}
              data-clip-id={clip.id}
              className={`${styles.row} ${clip.id === selectedId ? styles.selected : ''}`}
            >
              <button
                type="button"
                className={styles.select}
                aria-current={clip.id === selectedId ? 'true' : undefined}
                onPointerDown={(e) => {
                  pressedWith.current = e.pointerType
                }}
                onClick={() => {
                  const tapped = pressedWith.current === 'touch' || pressedWith.current === 'pen'
                  pressedWith.current = ''
                  if (tapped && clip.id === selectedId) onPlay(clip)
                  else onSelect(clip)
                }}
                // A double tap is two taps: the second already played the clip.
                onDoubleClick={() => {
                  if (!coarse) onPlay(clip)
                }}
                title="Click to select, double-click to play this clip"
              >
                <span className={styles.name}>Clip {i + 1}</span>
                <span className={styles.dotCell}>
                  {overlapping.has(clip.id) && (
                    <span
                      className={styles.overlap}
                      role="img"
                      aria-label="Overlaps another clip"
                      title="Overlaps another clip"
                    />
                  )}
                </span>
                <span className={styles.range}>
                  {formatTimePrecise(clip.start)} → {formatTimePrecise(clip.end)}
                </span>
                <span className={styles.duration}>{formatTimePrecise(clipDuration(clip))}</span>
              </button>
              <button
                type="button"
                className={`${ui.touchTarget} ${styles.trash}`}
                aria-label={`Delete clip ${i + 1}`}
                title={`Delete clip ${i + 1} (Delete)`}
                onClick={() => onDelete(clip)}
              >
                <Trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
})

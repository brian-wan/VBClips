import { memo, useEffect, useRef } from 'react'
import { Trash } from '../../components/Icons'
import { clipDuration, type Clip } from '../../lib/clips'
import { formatTime, formatTimePrecise } from '../../lib/time'
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
  const listRef = useRef<HTMLUListElement>(null)

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
        <p className={styles.empty}>No clips yet. Press Space to mark the start of a point.</p>
      ) : (
        <ul ref={listRef} className={styles.list} role="listbox" aria-label="Clips">
          {clips.map((clip, i) => (
            <li
              key={clip.id}
              data-clip-id={clip.id}
              role="option"
              aria-selected={clip.id === selectedId}
              className={`${styles.row} ${clip.id === selectedId ? styles.selected : ''}`}
              onClick={() => onSelect(clip)}
              onDoubleClick={() => onPlay(clip)}
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
              <button
                type="button"
                className={styles.trash}
                aria-label={`Delete clip ${i + 1}`}
                title={`Delete clip ${i + 1} (Delete)`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(clip)
                }}
                onDoubleClick={(e) => e.stopPropagation()}
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

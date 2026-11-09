import { memo } from 'react'
import { Sheet } from '../../components/Sheet'
import ui from '../../components/ui.module.css'
import { clipDuration, type Clip } from '../../lib/clips'
import { formatTimePrecise } from '../../lib/time'
import styles from './ClipsPanel.module.css'

type Props = {
  clips: Clip[]
  overlapping: Set<string>
  selectedId: string | null
  onSelect: (clip: Clip) => void
  onEdit: (clip: Clip) => void
  onExport: () => void
  onClose: () => void
}

export const ClipsPanel = memo(function ClipsPanel({
  clips,
  overlapping,
  selectedId,
  onSelect,
  onEdit,
  onExport,
  onClose,
}: Props) {
  return (
    <Sheet
      title={`Clips (${clips.length})`}
      onClose={onClose}
      drawerOnDesktop
      headerExtra={
        <button type="button" className={styles.export} onClick={onExport}>
          Export JSON
        </button>
      }
    >
      {clips.length === 0 ? (
        <p className={styles.empty}>No clips yet. Press Space to mark a point.</p>
      ) : (
        <ul className={styles.list}>
          {clips.map((clip, i) => (
            <li key={clip.id}>
              <div
                className={`${styles.row} ${clip.id === selectedId ? styles.selected : ''}`}
                role="button"
                tabIndex={-1}
                onClick={() => onSelect(clip)}
              >
                <div className={styles.info}>
                  <span className={styles.name}>
                    Clip {i + 1}
                    {overlapping.has(clip.id) && (
                      <span className={styles.overlap} title="Overlaps another clip" />
                    )}
                  </span>
                  <span className={styles.range}>
                    {formatTimePrecise(clip.start)} → {formatTimePrecise(clip.end)}
                  </span>
                </div>
                <span className={styles.duration}>{formatTimePrecise(clipDuration(clip))}</span>
                <button
                  type="button"
                  className={ui.pillSmall}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit(clip)
                  }}
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
})

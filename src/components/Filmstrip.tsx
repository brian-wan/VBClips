import { memo } from 'react'
import { useThumbnails } from '../media/thumbnails'
import styles from './Filmstrip.module.css'

type Props = {
  sourceId: string
  url: string | undefined
  /** One tile per time, each showing the frame nearest it once extracted. */
  times: readonly number[]
  /** The trim strip's frames are extracted before the timeline's. */
  priority?: boolean
  className?: string
}

const sameTimes = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((t, i) => t === b[i])

/** A row of preview frames, `#2C2C2E` placeholders until each frame arrives. */
export const Filmstrip = memo(
  function Filmstrip({ sourceId, url, times, priority = false, className }: Props) {
    const frames = useThumbnails(sourceId, url, times, priority)
    return (
      <div className={`${styles.tiles} ${className ?? ''}`} aria-hidden="true">
        {times.map((t, i) => (
          <div key={t} className={styles.tile}>
            {frames[i] && <img className={styles.frame} src={frames[i]} alt="" draggable={false} />}
          </div>
        ))}
      </div>
    )
  },
  (a, b) =>
    a.sourceId === b.sourceId &&
    a.url === b.url &&
    a.priority === b.priority &&
    a.className === b.className &&
    sameTimes(a.times, b.times),
)

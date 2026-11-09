import { useRef, useState, type PointerEvent } from 'react'
import type { Clip } from '../../lib/clips'
import { formatTime } from '../../lib/time'
import styles from './Scrubber.module.css'

type Props = {
  duration: number
  currentTime: number
  clips: Clip[]
  openStart: number | null
  rate: number
  onSeek: (t: number) => void
  onScrubStart: () => void
  onScrubEnd: () => void
}

const pct = (t: number, duration: number) => (duration > 0 ? (t / duration) * 100 : 0)

export function Scrubber({
  duration,
  currentTime,
  clips,
  openStart,
  rate,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return (Math.min(Math.max(clientX - rect.left, 0), rect.width) / rect.width) * duration
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    onScrubStart()
    onSeek(timeAt(e.clientX))
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeAt(e.clientX)
    setHover(t)
    if (dragging) onSeek(t)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    onScrubEnd()
  }

  const liveStart = openStart === null ? null : Math.min(openStart, currentTime)
  const liveEnd = openStart === null ? null : Math.max(openStart, currentTime)

  return (
    <div className={styles.wrap}>
      <div
        ref={trackRef}
        className={styles.hitArea}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div className={styles.track}>
          {clips.map((clip) => (
            <div
              key={clip.id}
              className={styles.clip}
              style={{
                left: `${pct(clip.start, duration)}%`,
                width: `${pct(clip.end - clip.start, duration)}%`,
              }}
            />
          ))}
          {liveStart !== null && liveEnd !== null && (
            <div
              className={styles.live}
              style={{
                left: `${pct(liveStart, duration)}%`,
                width: `${pct(liveEnd - liveStart, duration)}%`,
              }}
            />
          )}
        </div>
        <div className={styles.playhead} style={{ left: `${pct(currentTime, duration)}%` }} />
        {hover !== null && !dragging && (
          <div className={styles.tooltip} style={{ left: `${pct(hover, duration)}%` }}>
            {formatTime(hover)}
          </div>
        )}
      </div>
      <div className={styles.times}>
        <span>
          {formatTime(currentTime)}
          {rate > 1 && <span className={styles.rate}>{rate}×</span>}
        </span>
        <span>{formatTime(duration)} total</span>
      </div>
    </div>
  )
}

import { useRef, useState, type PointerEvent } from 'react'
import type { Clip } from '../../lib/clips'
import {
  edgeTime,
  hitTest,
  percentOf,
  timeAtX,
  trimClip,
  type ScrubberTarget,
  type TrimEdge,
} from '../../lib/scrubber'
import { formatTime, formatTimePrecise } from '../../lib/time'
import styles from './Scrubber.module.css'

type Props = {
  duration: number
  currentTime: number
  clips: Clip[]
  selectedId: string | null
  openStart: number | null
  onSeek: (t: number) => void
  onSelect: (id: string) => void
  onTrim: (clip: Clip) => void
  /** Called when a scrub or trim drag starts and ends, so the player can pause and resume. */
  onDragStart: () => void
  onDragEnd: () => void
}

type Drag =
  | { kind: 'pending'; id: string; startX: number }
  | { kind: 'scrub' }
  | { kind: 'trim'; edge: TrimEdge; original: Clip; draft: Clip }

/** Pointer travel in px before a press on a clip segment becomes a scrub instead of a select. */
const DRAG_THRESHOLD_PX = 3

const CURSOR: Record<ScrubberTarget['kind'], string> = {
  handle: 'ew-resize',
  playhead: 'grab',
  clip: 'pointer',
  track: 'pointer',
}

const span = (start: number, end: number, duration: number) => ({
  left: `${percentOf(start, duration)}%`,
  width: `${percentOf(end, duration) - percentOf(start, duration)}%`,
})

export function Scrubber({
  duration,
  currentTime,
  clips,
  selectedId,
  openStart,
  onSeek,
  onSelect,
  onTrim,
  onDragStart,
  onDragEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<{ t: number; target: ScrubberTarget } | null>(null)

  const measure = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 0
    const x = clientX - (rect?.left ?? 0)
    const target = hitTest({ x, width, duration, clips, selectedId, playhead: currentTime })
    return { x, t: timeAtX(x, width, duration), target }
  }

  const startScrub = (t: number) => {
    setDrag({ kind: 'scrub' })
    onDragStart()
    onSeek(t)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, t, target } = measure(e.clientX)
    const selected = clips.find((c) => c.id === selectedId)
    if (target.kind === 'handle' && selected) {
      setDrag({ kind: 'trim', edge: target.edge, original: selected, draft: selected })
      onDragStart()
      onSeek(edgeTime(selected, target.edge))
    } else if (target.kind === 'clip') {
      setDrag({ kind: 'pending', id: target.id, startX: x })
    } else {
      startScrub(t)
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const { x, t, target } = measure(e.clientX)
    setHover({ t, target })
    if (!drag) return
    if (drag.kind === 'pending' && Math.abs(x - drag.startX) > DRAG_THRESHOLD_PX) startScrub(t)
    else if (drag.kind === 'scrub') onSeek(t)
    else if (drag.kind === 'trim') {
      const draft = trimClip(drag.original, drag.edge, t, duration)
      setDrag({ ...drag, draft })
      onSeek(edgeTime(draft, drag.edge))
    }
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!drag) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDrag(null)
    if (drag.kind === 'pending') {
      if (!cancelled) onSelect(drag.id)
      return
    }
    if (drag.kind === 'trim' && !cancelled) onTrim(drag.draft)
    onDragEnd()
  }

  const trimming = drag?.kind === 'trim' ? drag : null
  const shown = trimming
    ? clips.map((c) => (c.id === trimming.draft.id ? trimming.draft : c))
    : clips
  const selected = shown.find((c) => c.id === selectedId)
  const liveStart = openStart === null ? null : Math.min(openStart, currentTime)
  const liveEnd = openStart === null ? null : Math.max(openStart, currentTime)
  const cursor =
    duration <= 0
      ? 'default'
      : drag?.kind === 'scrub'
        ? 'grabbing'
        : drag?.kind === 'trim'
          ? CURSOR.handle
          : CURSOR[hover?.target.kind ?? 'track']
  const tooltip = trimming
    ? {
        left: `${percentOf(edgeTime(trimming.draft, trimming.edge), duration)}%`,
        text: formatTimePrecise(edgeTime(trimming.draft, trimming.edge)),
      }
    : hover && duration > 0
      ? { left: `${percentOf(hover.t, duration)}%`, text: formatTime(hover.t) }
      : null

  return (
    <div className={styles.scrubber}>
      <div
        ref={trackRef}
        className={styles.hitArea}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={formatTime(currentTime)}
      >
        <div className={styles.track}>
          {shown.map((clip) => (
            <div
              key={clip.id}
              className={`${styles.clip} ${clip.id === selectedId ? styles.clipSelected : ''}`}
              style={span(clip.start, clip.end, duration)}
            />
          ))}
          {liveStart !== null && liveEnd !== null && (
            <div className={styles.live} style={span(liveStart, liveEnd, duration)} />
          )}
        </div>
        {selected && (
          <>
            <div
              className={`${styles.handle} ${trimming?.edge === 'start' ? styles.handleActive : ''}`}
              style={{ left: `${percentOf(selected.start, duration)}%` }}
            />
            <div
              className={`${styles.handle} ${trimming?.edge === 'end' ? styles.handleActive : ''}`}
              style={{ left: `${percentOf(selected.end, duration)}%` }}
            />
          </>
        )}
        <div className={styles.playhead} style={{ left: `${percentOf(currentTime, duration)}%` }} />
        {tooltip && (
          <div className={styles.tooltip} style={{ left: tooltip.left }}>
            {tooltip.text}
          </div>
        )}
      </div>
      <div className={styles.times}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

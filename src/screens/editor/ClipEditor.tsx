import { forwardRef, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Filmstrip } from '../../components/Filmstrip'
import { ProgressLine } from '../../components/ProgressLine'
import ui from '../../components/ui.module.css'
import { clipDuration, type Clip, type Span } from '../../lib/clips'
import { TRIM_TILE_PX, tileCount, tileTimes } from '../../lib/filmstrip'
import { edgeTime, trimClip, type TrimEdge } from '../../lib/scrubber'
import type { SourceMeta } from '../../lib/session'
import { formatTimePrecise } from '../../lib/time'
import { handleAt, shouldRecenter, timeAtX, trimWindow, xOfTime } from '../../lib/trimmer'
import { useElementWidth } from '../../hooks/useElementWidth'
import { usePointerDrag } from '../../hooks/usePointerDrag'
import { thumbnails } from '../../media/thumbnails'
import styles from './ClipEditor.module.css'

type Props = {
  clip: Clip
  number: number
  source: SourceMeta
  url: string | undefined
  /** Local playhead time, or null when the playhead is in another source. */
  playhead: number | null
  /** Seeks the main video to a local time of this clip's source. */
  onSeek: (localTime: number) => void
  onChange: (clip: Clip) => void
  onDragStart: () => void
  onDragEnd: () => void
  onPreview: (clip: Clip) => void
  onDelete: (clip: Clip) => void
}

type Drag = { edge: TrimEdge; original: Clip; draft: Clip; offset: number }

type View = { start: number; end: number; window: Span }

const percent = (t: number, window: Span) => `${(xOfTime(t, 1, window) * 100).toFixed(3)}%`

/** Selected clip editor pinned to the bottom of the sidebar. Focusable so `E` can jump into it. */
export const ClipEditor = forwardRef<HTMLElement, Props>(function ClipEditor(
  {
    clip,
    number,
    source,
    url,
    playhead,
    onSeek,
    onChange,
    onDragStart,
    onDragEnd,
    onPreview,
    onDelete,
  },
  ref,
) {
  const trackRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(trackRef)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [view, setView] = useState<View>(() => ({
    start: clip.start,
    end: clip.end,
    window: trimWindow(clip, source.duration),
  }))

  // The window stays put while a handle is dragged. Once the clip changes (a drop, an undo or a
  // timeline trim), recenter it if an edge has come within 10% of the window's edge.
  if (!drag && (view.start !== clip.start || view.end !== clip.end)) {
    setView({
      start: clip.start,
      end: clip.end,
      window: shouldRecenter(clip, view.window) ? trimWindow(clip, source.duration) : view.window,
    })
  }

  const { window: span } = view
  const shown = drag?.draft ?? clip
  const times = tileTimes(span.start, span.end, tileCount(width, TRIM_TILE_PX))
  const pending = thumbnails.progressOf(source.id, times)

  const localX = (e: PointerEvent<HTMLDivElement>) =>
    e.clientX - (trackRef.current?.getBoundingClientRect().left ?? 0)

  const trimDrag = usePointerDrag<HTMLDivElement>({
    onMove: (e) => {
      if (!drag) return
      const t = timeAtX(localX(e) - drag.offset, width, span)
      const draft = trimClip(drag.original, drag.edge, t, source.duration)
      setDrag({ ...drag, draft })
      onSeek(edgeTime(draft, drag.edge))
    },
    onCommit: () => {
      if (!drag) return
      setDrag(null)
      onChange(drag.draft)
      onDragEnd()
    },
    // Escape, or anything else that ends the drag early, puts the clip back as it was.
    onCancel: () => {
      if (!drag) return
      setDrag(null)
      onSeek(edgeTime(drag.original, drag.edge))
      onDragEnd()
    },
  })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || width <= 0) return
    const x = localX(e)
    const edge = handleAt(x, width, span, clip)
    if (!edge) {
      onSeek(timeAtX(x, width, span))
      return
    }
    trimDrag.begin(e)
    const offset = x - xOfTime(edgeTime(clip, edge), width, span)
    setDrag({ edge, original: clip, draft: clip, offset })
    onDragStart()
    onSeek(edgeTime(clip, edge))
  }

  const handleCursor = drag ? 'ew-resize' : undefined
  const playheadInside = playhead !== null && playhead >= span.start && playhead <= span.end

  return (
    <section ref={ref} className={styles.panel} tabIndex={-1} aria-label={`Edit clip ${number}`}>
      <header className={styles.header}>
        <h3 className={styles.title}>Clip {number}</h3>
        <span className={styles.length}>Length {formatTimePrecise(clipDuration(shown))}</span>
      </header>

      <div className={styles.trim}>
        <div
          className={styles.strip}
          style={{ cursor: handleCursor }}
          {...trimDrag.props}
          onPointerDown={onPointerDown}
          role="group"
          aria-label={`Trim clip ${number}`}
        >
          <div ref={trackRef} className={styles.track}>
            <Filmstrip
              sourceId={source.id}
              url={url}
              times={times}
              priority
              className={styles.filmstrip}
            />
            <div
              className={styles.dim}
              style={{ left: 0, right: `calc(100% - ${percent(shown.start, span)})` }}
            />
            <div className={styles.dim} style={{ left: percent(shown.end, span), right: 0 }} />
            <div
              className={styles.selection}
              style={{
                left: percent(shown.start, span),
                right: `calc(100% - ${percent(shown.end, span)})`,
              }}
            />
            {playheadInside && (
              <div className={styles.playhead} style={{ left: percent(playhead, span) }} />
            )}
            <div
              className={`${styles.handle} ${styles.handleStart} ${drag?.edge === 'start' ? styles.handleActive : ''}`}
              style={{ left: percent(shown.start, span) }}
              aria-hidden="true"
            />
            <div
              className={`${styles.handle} ${styles.handleEnd} ${drag?.edge === 'end' ? styles.handleActive : ''}`}
              style={{ left: percent(shown.end, span) }}
              aria-hidden="true"
            />
            {pending.done < pending.total && (
              <ProgressLine value={pending.done / pending.total} className={styles.framesLine} />
            )}
          </div>
        </div>
        <div className={styles.labels}>
          <span
            className={styles.labelStart}
            style={{ '--x': percent(shown.start, span) } as CSSProperties}
          >
            {formatTimePrecise(shown.start)}
          </span>
          <span
            className={styles.labelEnd}
            style={{ '--x': percent(shown.end, span) } as CSSProperties}
          >
            {formatTimePrecise(shown.end)}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${ui.secondary} ${ui.small}`}
          onClick={() => onPreview(clip)}
        >
          Preview
        </button>
        <button
          type="button"
          className={`${ui.destructive} ${ui.small}`}
          onClick={() => onDelete(clip)}
        >
          Delete clip
        </button>
      </div>
    </section>
  )
})

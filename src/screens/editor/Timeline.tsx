import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Plus } from '../../components/Icons'
import ui from '../../components/ui.module.css'
import type { Clip } from '../../lib/clips'
import { TIMELINE_TILE_PX, shouldRelayout, tileCount, tileTimes } from '../../lib/filmstrip'
import {
  edgeTime,
  hitTest,
  percentOf,
  timeAtX,
  trimClip,
  type ScrubberTarget,
  type TrimEdge,
} from '../../lib/scrubber'
import { dropIndex, toSequence, type Location } from '../../lib/sequence'
import type { OpenMarker, SourceMeta } from '../../lib/session'
import { formatTime, formatTimePrecise } from '../../lib/time'
import { useThumbnails } from '../../media/thumbnails'
import styles from './Timeline.module.css'

type Props = {
  sources: readonly SourceMeta[]
  urls: ReadonlyMap<string, string>
  clips: readonly Clip[]
  selectedId: string | null
  openStart: OpenMarker | null
  /** Where the playhead is: source index and local time. */
  location: Location
  currentTime: number
  duration: number
  /** Seeks inside block `index`; the end of a block stays in that block. */
  onSeekLocal: (index: number, localTime: number) => void
  onSelect: (id: string) => void
  onTrim: (clip: Clip) => void
  /** Called when a scrub or trim drag starts and ends, so the player can pause and resume. */
  onDragStart: () => void
  onDragEnd: () => void
  onRemoveSource: (id: string) => void
  onMoveSource: (from: number, to: number) => void
  onAddFiles: (files: File[]) => void
}

type StripDrag =
  | { kind: 'pending'; id: string; startX: number }
  | { kind: 'scrub' }
  | { kind: 'trim'; edge: TrimEdge; index: number; original: Clip; draft: Clip; tipX: number }

type Reorder = {
  from: number
  pointerId: number
  startX: number
  grabOffset: number
  width: number
  active: boolean
  /** Pointer x relative to the blocks row. */
  x: number
  slot: number
  /** Where the orange insertion line is drawn, or null when the drop would change nothing. */
  insertionX: number | null
}

/** Pointer travel in px before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 3
const BLOCK_GAP_PX = 2
const RELAYOUT_DELAY_MS = 200

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

/** Width of `ref`, updated at once the first time and then only after it changes by a tile. */
function useLaidOutWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    let laidOut = 0
    const apply = (next: number) => {
      laidOut = next
      setWidth(next)
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width
      window.clearTimeout(timer)
      if (laidOut === 0) apply(next)
      else if (shouldRelayout(laidOut, next, TIMELINE_TILE_PX)) {
        timer = window.setTimeout(() => apply(next), RELAYOUT_DELAY_MS)
      }
    })
    observer.observe(el)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [ref])
  return width
}

const Filmstrip = memo(function Filmstrip({
  sourceId,
  url,
  duration,
  width,
}: {
  sourceId: string
  url: string | undefined
  duration: number
  width: number
}) {
  const times = tileTimes(0, duration, tileCount(width, TIMELINE_TILE_PX))
  const frames = useThumbnails(sourceId, url, times)
  return (
    <div className={styles.tiles} aria-hidden="true">
      {times.map((t, i) => (
        <div key={t} className={styles.tile}>
          {frames[i] && <img className={styles.frame} src={frames[i]} alt="" draggable={false} />}
        </div>
      ))}
    </div>
  )
})

export function Timeline({
  sources,
  urls,
  clips,
  selectedId,
  openStart,
  location,
  currentTime,
  duration,
  onSeekLocal,
  onSelect,
  onTrim,
  onDragStart,
  onDragEnd,
  onRemoveSource,
  onMoveSource,
  onAddFiles,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const stripRefs = useRef(new Map<string, HTMLDivElement>())
  const blockRefs = useRef(new Map<string, HTMLDivElement>())
  const inputRef = useRef<HTMLInputElement>(null)
  const laidOutWidth = useLaidOutWidth(rowRef)
  const [drag, setDrag] = useState<StripDrag | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number; target: ScrubberTarget } | null>(null)
  const [reorder, setReorder] = useState<Reorder | null>(null)

  const reorderActive = reorder?.active ?? false
  useEffect(() => {
    if (!reorderActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setReorder(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [reorderActive])

  const rowLeft = () => rowRef.current?.getBoundingClientRect().left ?? 0

  /** The block under `clientX`, or the nearest one when the pointer is in a gap or outside. */
  const blockAt = (clientX: number) => {
    let best: { index: number; rect: DOMRect; distance: number } | null = null
    sources.forEach((source, index) => {
      const rect = stripRefs.current.get(source.id)?.getBoundingClientRect()
      if (!rect) return
      const distance =
        clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
      if (!best || distance < best.distance) best = { index, rect, distance }
    })
    return best as { index: number; rect: DOMRect; distance: number } | null
  }

  const measure = (clientX: number) => {
    const block = blockAt(clientX)
    if (!block) return null
    const source = sources[block.index]
    const x = clientX - block.rect.left
    const local = timeAtX(x, block.rect.width, source.duration)
    const target = hitTest({
      x,
      width: block.rect.width,
      duration: source.duration,
      clips: clips.filter((c) => c.sourceId === source.id),
      selectedId,
      playhead: location.index === block.index ? location.localTime : null,
    })
    return { index: block.index, x, local, t: toSequence(sources, block.index, local), target }
  }

  /** x of local time `t` in block `index`, relative to the blocks row. */
  const edgeX = (index: number, t: number) => {
    const source = sources[index]
    const rect = source && stripRefs.current.get(source.id)?.getBoundingClientRect()
    if (!rect) return 0
    return rect.left - rowLeft() + (percentOf(t, source.duration) / 100) * rect.width
  }

  const startScrub = (index: number, local: number) => {
    setDrag({ kind: 'scrub' })
    onDragStart()
    onSeekLocal(index, local)
  }

  const onStripDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const hit = measure(e.clientX)
    if (!hit) return
    const selected = clips.find((c) => c.id === selectedId)
    if (hit.target.kind === 'handle' && selected) {
      const index = sources.findIndex((s) => s.id === selected.sourceId)
      const tipX = edgeX(index, edgeTime(selected, hit.target.edge))
      setDrag({
        kind: 'trim',
        edge: hit.target.edge,
        index,
        original: selected,
        draft: selected,
        tipX,
      })
      onDragStart()
      onSeekLocal(index, edgeTime(selected, hit.target.edge))
    } else if (hit.target.kind === 'clip') {
      setDrag({ kind: 'pending', id: hit.target.id, startX: e.clientX })
    } else {
      startScrub(hit.index, hit.local)
    }
  }

  const onStripMove = (e: PointerEvent<HTMLDivElement>) => {
    const hit = measure(e.clientX)
    if (hit) setHover({ x: e.clientX - rowLeft(), t: hit.t, target: hit.target })
    if (!drag || !hit) return
    if (drag.kind === 'pending' && Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD_PX) {
      startScrub(hit.index, hit.local)
    } else if (drag.kind === 'scrub') {
      onSeekLocal(hit.index, hit.local)
    } else if (drag.kind === 'trim') {
      const source = sources[drag.index]
      const rect = stripRefs.current.get(source.id)?.getBoundingClientRect()
      if (!rect) return
      const t = timeAtX(e.clientX - rect.left, rect.width, source.duration)
      const draft = trimClip(drag.original, drag.edge, t, source.duration)
      setDrag({ ...drag, draft, tipX: edgeX(drag.index, edgeTime(draft, drag.edge)) })
      onSeekLocal(drag.index, edgeTime(draft, drag.edge))
    }
  }

  const endStripDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
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

  /** Insertion slot for a pointer at `clientX`: how many block midpoints lie left of it. */
  const slotAt = (clientX: number) =>
    sources.filter((source) => {
      const rect = blockRefs.current.get(source.id)?.getBoundingClientRect()
      return rect ? rect.left + rect.width / 2 < clientX : false
    }).length

  const onHeaderDown = (e: PointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return
    const rect = blockRefs.current.get(sources[index].id)?.getBoundingClientRect()
    if (!rect) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setReorder({
      from: index,
      pointerId: e.pointerId,
      startX: e.clientX,
      grabOffset: e.clientX - rect.left,
      width: rect.width,
      active: false,
      x: e.clientX - rowLeft(),
      slot: index,
      insertionX: null,
    })
  }

  const insertionLineX = (from: number, slot: number) => {
    if (dropIndex(from, slot) === from) return null
    const left = rowLeft()
    if (slot >= sources.length) {
      const last = blockRefs.current.get(sources[sources.length - 1].id)?.getBoundingClientRect()
      return last ? last.right - left + BLOCK_GAP_PX / 2 : null
    }
    const rect = blockRefs.current.get(sources[slot].id)?.getBoundingClientRect()
    return rect ? rect.left - left - BLOCK_GAP_PX / 2 : null
  }

  const onHeaderMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!reorder || reorder.pointerId !== e.pointerId) return
    const active = reorder.active || Math.abs(e.clientX - reorder.startX) > DRAG_THRESHOLD_PX
    const slot = slotAt(e.clientX)
    setReorder({
      ...reorder,
      active,
      x: e.clientX - rowLeft(),
      slot,
      insertionX: active ? insertionLineX(reorder.from, slot) : null,
    })
  }

  const endReorder = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!reorder || reorder.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setReorder(null)
    if (cancelled || !reorder.active) return
    const to = dropIndex(reorder.from, reorder.slot)
    if (to !== reorder.from) onMoveSource(reorder.from, to)
  }

  const trimming = drag?.kind === 'trim' ? drag : null
  const shown = trimming
    ? clips.map((c) => (c.id === trimming.draft.id ? trimming.draft : c))
    : clips
  const cursor =
    duration <= 0
      ? 'default'
      : drag?.kind === 'scrub'
        ? 'grabbing'
        : drag?.kind === 'trim'
          ? CURSOR.handle
          : CURSOR[hover?.target.kind ?? 'track']

  const tooltip = trimming
    ? { x: trimming.tipX, text: formatTimePrecise(edgeTime(trimming.draft, trimming.edge)) }
    : hover && !reorder
      ? { x: hover.x, text: formatTime(hover.t) }
      : null

  const gaps = BLOCK_GAP_PX * Math.max(sources.length - 1, 0)
  const blockWidth = (source: SourceMeta) =>
    duration > 0 ? ((laidOutWidth - gaps) * source.duration) / duration : 0

  const insertionX = reorder?.active ? reorder.insertionX : null

  const renderBlockBody = (source: SourceMeta, index: number, ghost: boolean): ReactNode => {
    const own = shown.filter((c) => c.sourceId === source.id)
    const selected = own.find((c) => c.id === selectedId)
    const live =
      openStart && openStart.sourceId === source.id
        ? location.index === index
          ? {
              start: Math.min(openStart.time, location.localTime),
              end: Math.max(openStart.time, location.localTime),
            }
          : { start: openStart.time, end: openStart.time }
        : null
    return (
      <>
        <Filmstrip
          sourceId={source.id}
          url={urls.get(source.id)}
          duration={source.duration}
          width={blockWidth(source)}
        />
        {own.map((clip) => (
          <div
            key={clip.id}
            className={`${styles.clip} ${clip.id === selectedId ? styles.clipSelected : ''}`}
            style={span(clip.start, clip.end, source.duration)}
          />
        ))}
        {live && (
          <div className={styles.live} style={span(live.start, live.end, source.duration)} />
        )}
        {selected && !ghost && (
          <>
            <div
              className={`${styles.handle} ${trimming?.edge === 'start' ? styles.handleActive : ''}`}
              style={{ left: `${percentOf(selected.start, source.duration)}%` }}
            />
            <div
              className={`${styles.handle} ${trimming?.edge === 'end' ? styles.handleActive : ''}`}
              style={{ left: `${percentOf(selected.end, source.duration)}%` }}
            />
          </>
        )}
      </>
    )
  }

  const header = (source: SourceMeta, removable: boolean) => (
    <>
      <span className={styles.name}>{source.name}</span>
      <span className={styles.blockDuration}>{formatTime(source.duration)}</span>
      {removable && (
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${source.name}`}
          title={`Remove ${source.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemoveSource(source.id)}
        >
          ×
        </button>
      )}
    </>
  )

  const ghostSource = reorder?.active ? sources[reorder.from] : null

  return (
    <div className={styles.timeline}>
      <div className={styles.row}>
        <div ref={rowRef} className={styles.blocks}>
          {sources.length === 0 && <div className={styles.empty}>Add a video to start</div>}
          {sources.map((source, index) => {
            const isCurrent = location.index === index
            const dragged = reorder?.active && reorder.from === index
            return (
              <div
                key={source.id}
                ref={(el) => {
                  if (el) blockRefs.current.set(source.id, el)
                  else blockRefs.current.delete(source.id)
                }}
                className={`${styles.block} ${dragged ? styles.blockDragged : ''}`}
                style={{ flexGrow: source.duration }}
              >
                <div
                  className={`${styles.header} ${reorder?.active ? styles.headerDragging : ''}`}
                  title={`${source.name}, drag to reorder`}
                  onPointerDown={(e) => onHeaderDown(e, index)}
                  onPointerMove={onHeaderMove}
                  onPointerUp={(e) => endReorder(e, false)}
                  onPointerCancel={(e) => endReorder(e, true)}
                >
                  {header(source, true)}
                </div>
                <div
                  ref={(el) => {
                    if (el) stripRefs.current.set(source.id, el)
                    else stripRefs.current.delete(source.id)
                  }}
                  className={styles.strip}
                  style={{ cursor }}
                  onPointerDown={onStripDown}
                  onPointerMove={onStripMove}
                  onPointerUp={(e) => endStripDrag(e, false)}
                  onPointerCancel={(e) => endStripDrag(e, true)}
                  onPointerLeave={() => setHover(null)}
                  role="slider"
                  aria-label={`Seek in ${source.name}`}
                  aria-valuemin={0}
                  aria-valuemax={source.duration}
                  aria-valuenow={isCurrent ? location.localTime : 0}
                  aria-valuetext={formatTime(currentTime)}
                >
                  {renderBlockBody(source, index, false)}
                </div>
                {isCurrent && (
                  <div
                    className={styles.playhead}
                    style={{ left: `${percentOf(location.localTime, source.duration)}%` }}
                  />
                )}
              </div>
            )
          })}
          {ghostSource && reorder && (
            <div
              className={styles.ghost}
              style={{ left: reorder.x - reorder.grabOffset, width: reorder.width }}
              aria-hidden="true"
            >
              <div className={styles.header}>{header(ghostSource, false)}</div>
              <div className={styles.strip}>{renderBlockBody(ghostSource, reorder.from, true)}</div>
            </div>
          )}
          {insertionX !== null && <div className={styles.insertion} style={{ left: insertionX }} />}
          {tooltip && (
            <div className={styles.tooltip} style={{ left: tooltip.x }}>
              {tooltip.text}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`${styles.plus} ${ui.tip} ${ui.tipEnd}`}
          aria-label="Add video"
          data-tip="Add video"
          onClick={() => inputRef.current?.click()}
        >
          <Plus size={20} />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          data-testid="add-video-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length > 0) onAddFiles(files)
          }}
        />
      </div>
      <div className={styles.times}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { ChevronLeft, FastForward, ListIcon, PauseIcon, PlayIcon, Plus } from '../components/Icons'
import { ShortcutsModal } from '../components/ShortcutsModal'
import { Toasts } from '../components/Toasts'
import ui from '../components/ui.module.css'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useToasts } from '../hooks/useToasts'
import { useVideoPlayer } from '../hooks/useVideoPlayer'
import {
  FRAME_DURATION,
  findOverlappingIds,
  manualClipSpan,
  totalClippedDuration,
  type Clip,
} from '../lib/clips'
import { currentClipIndex, nextClipIndex, prevClipIndex } from '../lib/navigation'
import { canEndMark, initialSession, sessionReducer } from '../lib/session'
import { formatTime } from '../lib/time'
import { unplayableMessage } from '../playable'
import styles from './Editor.module.css'
import { ClipEditor } from './editor/ClipEditor'
import { ClipsPanel } from './editor/ClipsPanel'
import { Scrubber } from './editor/Scrubber'

type Props = {
  file: File
  clips: Clip[]
  playhead: number
  onExit: () => void
  onError: (message: string) => void
}

const STICKY_SPEEDS = [1, 1.5, 2]
const HOLD_SPEED = 2
const NO_CLIPS_LABEL = '—'

const newId = () => crypto.randomUUID()

export function Editor({
  file,
  clips: initialClips,
  playhead: initialPlayhead,
  onExit,
  onError,
}: Props) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession, (s) =>
    sessionReducer(s, {
      type: 'load',
      video: { name: file.name, size: file.size, lastModified: file.lastModified, duration: 0 },
      clips: initialClips,
    }),
  )
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useVideoPlayer(videoRef)
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts()
  const [src] = useState(() => URL.createObjectURL(file))
  const [stickySpeed, setStickySpeed] = useState(1)
  const [holding, setHolding] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const resumeAfterScrub = useRef(false)

  useEffect(() => () => URL.revokeObjectURL(src), [src])

  const rate = holding ? HOLD_SPEED : stickySpeed
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate
  }, [rate])

  const { clips, selectedId, openStart } = state
  const duration = player.duration
  const overlapping = useMemo(() => findOverlappingIds(clips), [clips])
  const totalClipped = useMemo(() => totalClippedDuration(clips), [clips])
  const selectedIndex = clips.findIndex((c) => c.id === selectedId)
  const editingIndex = clips.findIndex((c) => c.id === editingId)
  const editingClip = editingIndex >= 0 ? clips[editingIndex] : null
  const pillIndex =
    selectedIndex >= 0 ? selectedIndex : currentClipIndex(clips, player.currentTime, null)

  const now = () => videoRef.current?.currentTime ?? player.currentTime

  const goToClip = (index: number) => {
    const clip = clips[index]
    if (!clip) return
    player.seek(clip.start)
    dispatch({ type: 'select', id: clip.id })
  }

  const mark = () => {
    const t = now()
    if (openStart === null) {
      dispatch({ type: 'markStart', time: t })
    } else if (canEndMark(openStart, t)) {
      dispatch({ type: 'markEnd', time: t, id: newId() })
    } else {
      showToast('Clip end must come after its start')
    }
  }

  const addManualClip = () => {
    const span = manualClipSpan(now(), duration)
    if (span.end - span.start <= 0) return
    dispatch({ type: 'addClip', clip: { id: newId(), ...span } })
  }

  const deleteClip = (clip: Clip) => {
    const number = clips.findIndex((c) => c.id === clip.id) + 1
    dispatch({ type: 'deleteClip', id: clip.id })
    if (editingId === clip.id) setEditingId(null)
    showToast(`Clip ${number} deleted`, {
      timeout: 5000,
      action: { label: 'Undo', onClick: () => dispatch({ type: 'undo' }) },
    })
  }

  const cycleSpeed = () =>
    setStickySpeed((s) => STICKY_SPEEDS[(STICKY_SPEEDS.indexOf(s) + 1) % STICKY_SPEEDS.length])

  const { seek } = player
  const selectFromPanel = useCallback(
    (clip: Clip) => {
      seek(clip.start)
      dispatch({ type: 'select', id: clip.id })
    },
    [seek],
  )

  const editFromPanel = useCallback((clip: Clip) => {
    dispatch({ type: 'select', id: clip.id })
    setEditingId(clip.id)
  }, [])

  const exportJson = useCallback(() => undefined, [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  const selectedClip = selectedIndex >= 0 ? clips[selectedIndex] : null

  useEditorShortcuts({
    mark,
    togglePlay: player.toggle,
    seekBy: (seconds) => player.seek(now() + seconds),
    stepFrame: (direction) => {
      if (player.paused) player.seek(now() + direction * FRAME_DURATION)
    },
    prevClip: () => goToClip(prevClipIndex(clips, now(), selectedId)),
    nextClip: () => goToClip(nextClipIndex(clips, now(), selectedId)),
    cycleSpeed,
    editSelected: () => {
      if (selectedClip) setEditingId(selectedClip.id)
    },
    deleteSelected: () => {
      if (selectedClip) deleteClip(selectedClip)
    },
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    escape: () => {
      if (helpOpen) setHelpOpen(false)
      else if (editingClip) setEditingId(null)
      else if (panelOpen) setPanelOpen(false)
      else if (openStart !== null) dispatch({ type: 'cancelMark' })
    },
    showShortcuts: () => setHelpOpen(true),
  })

  const onVideoPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left > (rect.width * 2) / 3) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setHolding(true)
    }
  }

  const onVideoPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (holding) {
      setHolding(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left <= (rect.width * 2) / 3) player.toggle()
  }

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <button type="button" className={ui.iconButton} aria-label="Back" onClick={onExit}>
          <ChevronLeft />
        </button>
        <div className={styles.topActions}>
          <span className={styles.joinWrap} data-tooltip="Coming soon">
            <button type="button" className={ui.pill} disabled>
              Join {clips.length} {clips.length === 1 ? 'Clip' : 'Clips'} (
              {formatTime(totalClipped)})
            </button>
          </span>
          <button
            type="button"
            className={ui.iconButton}
            aria-label="Add a 2 second clip at the playhead"
            onClick={addManualClip}
            disabled={duration <= 0}
          >
            <Plus />
          </button>
          <button
            type="button"
            className={ui.iconButton}
            aria-label="Show clips"
            onClick={() => setPanelOpen(true)}
          >
            <ListIcon />
            {clips.length > 0 && <span className={ui.badge}>{clips.length}</span>}
          </button>
        </div>
      </header>

      <button
        type="button"
        className={`${styles.speedLabel} ${rate > 1 ? styles.speedVisible : ''}`}
        onClick={cycleSpeed}
        tabIndex={rate > 1 ? 0 : -1}
      >
        <FastForward size={16} /> {rate}× speed
      </button>

      <div className={styles.videoFrame}>
        <video
          ref={videoRef}
          className={styles.video}
          src={src}
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            dispatch({ type: 'setDuration', duration: video.duration })
            video.playbackRate = rate
            if (initialPlayhead > 0) player.seek(initialPlayhead)
          }}
          onError={() => onError(unplayableMessage(file.name))}
        />
        <div
          className={styles.videoHit}
          onPointerDown={onVideoPointerDown}
          onPointerUp={onVideoPointerUp}
          onPointerCancel={() => setHolding(false)}
        />
      </div>

      <Scrubber
        duration={duration}
        currentTime={player.currentTime}
        clips={clips}
        openStart={openStart}
        rate={rate}
        onSeek={player.seek}
        onScrubStart={() => {
          resumeAfterScrub.current = !player.paused
          player.pause()
        }}
        onScrubEnd={() => {
          if (resumeAfterScrub.current) player.play()
        }}
      />

      <div className={styles.controls}>
        <div className={styles.navPill}>
          <button
            type="button"
            aria-label="Previous clip"
            disabled={clips.length === 0}
            onClick={() => goToClip(prevClipIndex(clips, now(), selectedId))}
          >
            ‹
          </button>
          <span>
            {clips.length === 0
              ? NO_CLIPS_LABEL
              : pillIndex >= 0
                ? `Clip ${pillIndex + 1}`
                : 'Clips'}
          </span>
          <button
            type="button"
            aria-label="Next clip"
            disabled={clips.length === 0}
            onClick={() => goToClip(nextClipIndex(clips, now(), selectedId))}
          >
            ›
          </button>
        </div>

        <button
          type="button"
          className={`${styles.markButton} ${openStart !== null ? styles.marking : ''}`}
          aria-label={openStart === null ? 'Mark clip start' : 'Mark clip end'}
          onClick={mark}
        >
          <span className={openStart === null ? styles.ring : styles.stop} />
        </button>

        <div className={styles.playCell}>
          <button
            type="button"
            className={styles.playButton}
            aria-label={player.paused ? 'Play' : 'Pause'}
            onClick={player.toggle}
          >
            {player.paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
          </button>
        </div>
      </div>

      {panelOpen && (
        <ClipsPanel
          clips={clips}
          overlapping={overlapping}
          selectedId={selectedId}
          onSelect={selectFromPanel}
          onEdit={editFromPanel}
          onExport={exportJson}
          onClose={closePanel}
        />
      )}

      {editingClip && (
        <ClipEditor
          clip={editingClip}
          number={editingIndex + 1}
          duration={duration}
          playhead={player.currentTime}
          onChange={(clip) => dispatch({ type: 'updateClip', clip })}
          onPreview={(clip) => player.playRange(clip.start, clip.end)}
          onDelete={deleteClip}
          onClose={() => setEditingId(null)}
        />
      )}

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

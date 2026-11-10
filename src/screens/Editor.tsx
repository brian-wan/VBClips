import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ChevronLeft, FastForward, ListIcon, PauseIcon, PlayIcon } from '../components/Icons'
import { ShortcutsModal } from '../components/ShortcutsModal'
import { Toasts } from '../components/Toasts'
import ui from '../components/ui.module.css'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useSessionPersistence } from '../hooks/useSessionPersistence'
import { useToasts } from '../hooks/useToasts'
import { useVideoPlayer } from '../hooks/useVideoPlayer'
import { findOverlappingIds, manualClipSpan, totalClippedDuration, type Clip } from '../lib/clips'
import { currentClipIndex, nextClipIndex, prevClipIndex } from '../lib/navigation'
import { canEndMark, initialSession, sessionReducer } from '../lib/session'
import { buildSavedSession, exportFileName } from '../lib/persistence'
import { nextSpeed } from '../lib/speed'
import { formatTime } from '../lib/time'
import { downloadJson } from '../download'
import { unplayableMessage } from '../playable'
import styles from './Editor.module.css'
import { ClipEditor } from './editor/ClipEditor'
import { ClipsList } from './editor/ClipsList'
import { JoinDialog } from './editor/JoinDialog'
import { Scrubber } from './editor/Scrubber'
import { TransportBar } from './editor/TransportBar'

type Props = {
  file: File
  clips: Clip[]
  playhead: number
  onExit: () => void
  onError: (message: string) => void
}

type Flash = { id: number; playing: boolean }

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
  const editorRef = useRef<HTMLElement>(null)
  const player = useVideoPlayer(videoRef)
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts()
  const [speed, setSpeed] = useState(1)
  const [helpOpen, setHelpOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const resumeAfterDrag = useRef(false)
  const lastPlayhead = useRef(initialPlayhead)
  useEffect(() => {
    if (player.duration > 0) lastPlayhead.current = player.currentTime
  }, [player.currentTime, player.duration])
  const saveNow = useSessionPersistence(state, () => lastPlayhead.current)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const url = URL.createObjectURL(file)
    video.src = url
    return () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  const { clips, selectedId, openStart, video } = state
  const duration = player.duration
  const overlapping = useMemo(() => findOverlappingIds(clips), [clips])
  const totalClipped = useMemo(() => totalClippedDuration(clips), [clips])
  const selectedIndex = clips.findIndex((c) => c.id === selectedId)
  const selectedClip = selectedIndex >= 0 ? clips[selectedIndex] : null
  const labelIndex =
    selectedIndex >= 0 ? selectedIndex : currentClipIndex(clips, player.currentTime, null)

  const now = () => videoRef.current?.currentTime ?? player.currentTime

  const togglePlay = () => {
    const playing = videoRef.current?.paused ?? false
    player.toggle()
    setFlash((f) => ({ id: (f?.id ?? 0) + 1, playing }))
  }

  const goToClip = (index: number) => {
    const clip = clips[index]
    if (!clip) return
    player.seek(clip.start)
    dispatch({ type: 'select', id: clip.id })
  }

  const openInEditor = () => {
    const index = selectedIndex >= 0 ? selectedIndex : Math.max(labelIndex, 0)
    const clip = clips[index]
    if (!clip) return
    if (clip.id !== selectedId) goToClip(index)
    setSidebarOpen(true)
    requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }))
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

  const deleteClip = useCallback(
    (clip: Clip) => {
      const number = clips.findIndex((c) => c.id === clip.id) + 1
      dispatch({ type: 'deleteClip', id: clip.id })
      showToast(`Clip ${number} deleted`, {
        timeout: 5000,
        action: { label: 'Undo', onClick: () => dispatch({ type: 'undo' }) },
      })
    },
    [clips, showToast],
  )

  const { seek, playRange } = player
  const selectFromList = useCallback(
    (clip: Clip) => {
      seek(clip.start)
      dispatch({ type: 'select', id: clip.id })
    },
    [seek],
  )
  const playFromList = useCallback(
    (clip: Clip) => {
      dispatch({ type: 'select', id: clip.id })
      playRange(clip.start, clip.end)
    },
    [playRange],
  )

  const getPlayhead = useCallback(() => lastPlayhead.current, [])
  const exportJson = () => {
    if (!video) return
    downloadJson(
      exportFileName(video.name),
      buildSavedSession(video, clips, getPlayhead(), Date.now()),
    )
  }

  useEditorShortcuts({
    mark,
    togglePlay,
    seekBy: (seconds) => player.seek(now() + seconds),
    prevClip: () => goToClip(prevClipIndex(clips, now(), selectedId)),
    nextClip: () => goToClip(nextClipIndex(clips, now(), selectedId)),
    cycleSpeed: () => setSpeed(nextSpeed),
    editSelected: openInEditor,
    deleteSelected: () => {
      if (selectedClip) deleteClip(selectedClip)
    },
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    escape: () => {
      if (openStart !== null) dispatch({ type: 'cancelMark' })
      else if (selectedId !== null) dispatch({ type: 'select', id: null })
    },
    showShortcuts: () => setHelpOpen(true),
  })

  const clipWord = clips.length === 1 ? 'Clip' : 'Clips'

  return (
    <div className={`${styles.page} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
      <header className={styles.topBar}>
        <div className={styles.topStart}>
          <button
            type="button"
            className={`${styles.homeButton} ${ui.tip} ${ui.tipBelow}`}
            data-tip="Save and go home"
            onClick={() => {
              saveNow()
              onExit()
            }}
          >
            <ChevronLeft size={18} />
            Home
          </button>
        </div>
        <div className={styles.fileInfo}>
          <span className={styles.fileName} title={file.name}>
            {file.name}
          </span>
          <span className={styles.fileDuration}>· {formatTime(duration)}</span>
        </div>
        <div className={styles.topEnd}>
          <button
            type="button"
            className={`${ui.pillSecondary} ${styles.topPill} ${ui.tip} ${ui.tipBelow}`}
            data-tip="Download the clip markers as JSON"
            onClick={exportJson}
          >
            Export JSON
          </button>
          <span
            className={`${ui.tip} ${ui.tipBelow} ${ui.tipEnd}`}
            data-tip={clips.length === 0 ? 'Mark a clip first' : 'Join the clips into one video'}
          >
            <button
              type="button"
              className={`${ui.pill} ${styles.topPill}`}
              disabled={clips.length === 0}
              onClick={(e) => {
                e.currentTarget.blur()
                player.pause()
                setJoinOpen(true)
              }}
            >
              Join {clips.length} {clipWord} ({formatTime(totalClipped)})
            </button>
          </span>
          <button
            type="button"
            className={`${ui.iconButton} ${styles.sidebarToggle} ${ui.tip} ${ui.tipBelow} ${ui.tipEnd}`}
            aria-label={sidebarOpen ? 'Hide clips' : 'Show clips'}
            aria-expanded={sidebarOpen}
            data-tip={sidebarOpen ? 'Hide clips' : 'Show clips'}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <ListIcon size={20} />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.videoColumn}>
          <div className={styles.stage}>
            <div className={styles.videoFrame} onClick={togglePlay}>
              <video
                ref={videoRef}
                className={styles.video}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget
                  dispatch({ type: 'setDuration', duration: el.duration })
                  el.playbackRate = speed
                  if (initialPlayhead > 0) player.seek(initialPlayhead)
                }}
                onError={(e) => {
                  if (e.currentTarget.error) onError(unplayableMessage(file.name))
                }}
              />
              {speed > 1 && (
                <div className={styles.speedBadge}>
                  <FastForward size={14} />
                  {speed}× speed
                </div>
              )}
              {flash && (
                <div key={flash.id} className={styles.flash} aria-hidden="true">
                  {flash.playing ? <PlayIcon size={32} /> : <PauseIcon size={32} />}
                </div>
              )}
            </div>
            <Toasts toasts={toasts} onDismiss={dismissToast} />
          </div>

          <Scrubber
            duration={duration}
            currentTime={player.currentTime}
            clips={clips}
            selectedId={selectedId}
            openStart={openStart}
            onSeek={player.seek}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onTrim={(clip) => dispatch({ type: 'updateClip', clip })}
            onDragStart={() => {
              resumeAfterDrag.current = !player.paused
              player.pause()
            }}
            onDragEnd={() => {
              if (resumeAfterDrag.current) player.play()
            }}
          />

          <TransportBar
            paused={player.paused}
            marking={openStart !== null}
            clipLabel={clips.length === 0 ? null : `Clip ${Math.max(labelIndex, 0) + 1}`}
            hasClips={clips.length > 0}
            speed={speed}
            canAddClip={duration > 0}
            onTogglePlay={togglePlay}
            onSeekBy={(seconds) => player.seek(now() + seconds)}
            onPrevClip={() => goToClip(prevClipIndex(clips, now(), selectedId))}
            onNextClip={() => goToClip(nextClipIndex(clips, now(), selectedId))}
            onOpenClip={openInEditor}
            onMark={mark}
            onSpeed={setSpeed}
            onAddClip={addManualClip}
            onShowShortcuts={() => setHelpOpen(true)}
          />
        </section>

        <aside className={styles.sidebar} aria-label="Clips">
          <ClipsList
            clips={clips}
            overlapping={overlapping}
            selectedId={selectedId}
            totalClipped={totalClipped}
            onSelect={selectFromList}
            onPlay={playFromList}
            onDelete={deleteClip}
          />
          {selectedClip && (
            <ClipEditor
              key={selectedClip.id}
              ref={editorRef}
              clip={selectedClip}
              number={selectedIndex + 1}
              duration={duration}
              playhead={player.currentTime}
              onChange={(clip) => dispatch({ type: 'updateClip', clip })}
              onPreview={(clip) => player.playRange(clip.start, clip.end)}
              onDelete={deleteClip}
            />
          )}
        </aside>
      </main>

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}
      {joinOpen && (
        <JoinDialog
          file={file}
          clips={clips}
          duration={duration}
          onClose={() => setJoinOpen(false)}
        />
      )}
    </div>
  )
}

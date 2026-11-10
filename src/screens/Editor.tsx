import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import type { EditorInput } from '../App'
import { ChevronLeft, FastForward, ListIcon, PauseIcon, PlayIcon } from '../components/Icons'
import { ShortcutsModal } from '../components/ShortcutsModal'
import { Toasts } from '../components/Toasts'
import ui from '../components/ui.module.css'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useSessionPersistence } from '../hooks/useSessionPersistence'
import { useToasts } from '../hooks/useToasts'
import { useVideoPlayer } from '../hooks/useVideoPlayer'
import { findOverlappingIds, totalClippedDuration, type Clip } from '../lib/clips'
import { fingerprint } from '../lib/fingerprint'
import { currentClipIndex, nextClipIndex, prevClipIndex } from '../lib/navigation'
import { toSequence } from '../lib/sequence'
import { initialSession, markEndProblem, sessionReducer } from '../lib/session'
import { nextSpeed } from '../lib/speed'
import { formatTime } from '../lib/time'
import { loadSource } from '../media/loadSource'
import { SourceFiles } from '../media/sourceFiles'
import { thumbnails } from '../media/thumbnails'
import { unplayableMessage } from '../playable'
import styles from './Editor.module.css'
import { ClipEditor } from './editor/ClipEditor'
import { ClipsList } from './editor/ClipsList'
import { JoinDialog } from './editor/JoinDialog'
import { Timeline } from './editor/Timeline'
import { TransportBar } from './editor/TransportBar'

type Props = EditorInput & {
  onExit: () => void
  onError: (message: string) => void
}

type Flash = { id: number; playing: boolean }

const newId = () => crypto.randomUUID()
const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

export function Editor({
  sources: initialSources,
  clips: initialClips,
  playhead: initialPlayhead,
  onExit,
  onError,
}: Props) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession, (s) =>
    sessionReducer(s, {
      type: 'load',
      sources: initialSources.map((s) => s.meta),
      clips: initialClips,
    }),
  )
  const [files] = useState(() => {
    const store = new SourceFiles()
    for (const { meta, file } of initialSources) store.add(meta.id, file)
    return store
  })
  const { sources, clips, selectedId, openStart } = state

  const urls = useMemo(
    () =>
      new Map(
        sources.flatMap((s) => {
          const url = files.url(s.id)
          return url ? [[s.id, url] as const] : []
        }),
      ),
    [sources, files],
  )
  useEffect(() => {
    const ids = new Set(sources.map((s) => s.id))
    files.retain(ids)
    thumbnails.retain(ids)
  }, [sources, files])
  useEffect(() => {
    files.keep()
    return () => {
      files.releaseSoon()
      thumbnails.retain(new Set())
    }
  }, [files])

  const playerSources = useMemo(
    () => sources.map((s) => ({ id: s.id, duration: s.duration, url: urls.get(s.id) })),
    [sources, urls],
  )
  const videoRef = useRef<HTMLVideoElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts()
  const openStartRef = useRef(state.openStart)
  useEffect(() => {
    openStartRef.current = state.openStart
  })
  const player = useVideoPlayer(videoRef, playerSources, initialPlayhead, {
    // Playback ran into the next video with a clip still open: it stays open, but say why it
    // cannot end here.
    onAutoAdvance: () => {
      if (openStartRef.current !== null) showToast('A clip can’t span two videos')
    },
  })
  const [speed, setSpeed] = useState(1)
  const [helpOpen, setHelpOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [droppingFiles, setDroppingFiles] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const resumeAfterDrag = useRef(false)
  const lastPlayhead = useRef(initialPlayhead)
  useEffect(() => {
    if (player.duration > 0) lastPlayhead.current = player.currentTime
  }, [player.currentTime, player.duration])
  const getPlayhead = useCallback(() => lastPlayhead.current, [])
  const saveNow = useSessionPersistence(state, getPlayhead)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.defaultPlaybackRate = speed
    video.playbackRate = speed
  }, [speed])

  const duration = player.duration
  const { location } = player
  const currentSource = location.index >= 0 ? sources[location.index] : null
  const overlapping = useMemo(() => findOverlappingIds(clips), [clips])
  const totalClipped = useMemo(() => totalClippedDuration(clips), [clips])
  /** Clips in sequence time, for navigation across sources. Same order as `clips`. */
  const sequenceClips = useMemo(
    () =>
      clips.map((c) => {
        const index = sources.findIndex((s) => s.id === c.sourceId)
        return {
          id: c.id,
          start: toSequence(sources, index, c.start),
          end: toSequence(sources, index, c.end),
        }
      }),
    [clips, sources],
  )
  const selectedIndex = clips.findIndex((c) => c.id === selectedId)
  const selectedClip = selectedIndex >= 0 ? clips[selectedIndex] : null
  const selectedSource = selectedClip
    ? (sources.find((s) => s.id === selectedClip.sourceId) ?? null)
    : null
  const labelIndex =
    selectedIndex >= 0 ? selectedIndex : currentClipIndex(sequenceClips, player.currentTime, null)

  const now = () => player.now().time

  const togglePlay = () => {
    if (sources.length === 0) return
    const playing = videoRef.current?.paused ?? false
    player.toggle()
    setFlash((f) => ({ id: (f?.id ?? 0) + 1, playing }))
  }

  const goToClip = (index: number) => {
    const clip = sequenceClips[index]
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
    const here = player.now()
    const source = sources[here.index]
    if (!source) return
    if (openStart === null) {
      dispatch({ type: 'markStart', sourceId: source.id, time: here.localTime })
      if (player.paused) player.play()
      return
    }
    const problem = markEndProblem(openStart, source.id, here.localTime)
    if (problem === null) {
      dispatch({ type: 'markEnd', sourceId: source.id, time: here.localTime, id: newId() })
    } else if (problem === 'otherSource') {
      showToast('A clip can’t span two videos')
    } else {
      showToast('Clip end must come after its start')
    }
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

  const removeSource = (id: string) => {
    const source = sources.find((s) => s.id === id)
    if (!source) return
    dispatch({ type: 'removeSource', id })
    showToast(`${source.name} removed`, {
      timeout: 5000,
      action: { label: 'Undo', onClick: () => dispatch({ type: 'undo' }) },
    })
  }

  const addFiles = async (picked: File[]) => {
    const known = new Set(sources.map((s) => s.id))
    let duplicate = false
    const fresh = picked.filter((file) => {
      const id = fingerprint(file)
      if (known.has(id)) {
        duplicate = true
        return false
      }
      known.add(id)
      return true
    })
    if (duplicate) showToast('Already in the timeline')
    const loaded = await Promise.all(fresh.map(loadSource))
    loaded.forEach((source, i) => {
      if (!source) {
        showToast(unplayableMessage(fresh[i].name), { timeout: 5000 })
        return
      }
      files.add(source.meta.id, source.file)
      dispatch({ type: 'addSource', source: source.meta })
    })
  }

  const { seek, seekLocal, playRange } = player
  const sequenceStart = useCallback(
    (clip: Clip) =>
      toSequence(
        sources,
        sources.findIndex((s) => s.id === clip.sourceId),
        clip.start,
      ),
    [sources],
  )
  const selectFromList = useCallback(
    (clip: Clip) => {
      seek(sequenceStart(clip))
      dispatch({ type: 'select', id: clip.id })
    },
    [seek, sequenceStart],
  )
  const playFromList = useCallback(
    (clip: Clip) => {
      dispatch({ type: 'select', id: clip.id })
      const start = sequenceStart(clip)
      playRange(start, start + (clip.end - clip.start))
    },
    [playRange, sequenceStart],
  )

  const selectedSourceIndex = selectedSource ? sources.indexOf(selectedSource) : -1
  const seekInSelectedSource = useCallback(
    (localTime: number) => {
      if (selectedSourceIndex >= 0) seekLocal(selectedSourceIndex, localTime)
    },
    [seekLocal, selectedSourceIndex],
  )

  const { pause, play, paused } = player
  const pauseForDrag = useCallback(() => {
    resumeAfterDrag.current = !paused
    pause()
  }, [paused, pause])
  const resumeAfterDragEnd = useCallback(() => {
    if (resumeAfterDrag.current) play()
  }, [play])

  useEditorShortcuts({
    mark,
    togglePlay,
    seekBy: (seconds) => player.seek(now() + seconds),
    prevClip: () => goToClip(prevClipIndex(sequenceClips, now(), selectedId)),
    nextClip: () => goToClip(nextClipIndex(sequenceClips, now(), selectedId)),
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
    <div
      className={`${styles.page} ${sidebarOpen ? styles.sidebarOpen : ''} ${droppingFiles ? styles.dropping : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDroppingFiles(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDroppingFiles(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDroppingFiles(false)
        void addFiles([...e.dataTransfer.files])
      }}
    >
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
          {sources.length === 1 ? (
            <>
              <span className={styles.fileName} title={sources[0].name}>
                {sources[0].name}
              </span>
              <span className={styles.fileDuration}>· {formatTime(duration)}</span>
            </>
          ) : (
            <span className={styles.fileName}>
              {sources.length === 0 ? 'No videos' : `${sources.length} videos`}{' '}
              <span className={styles.fileDuration}>· {formatTime(duration)}</span>
            </span>
          )}
        </div>
        <div className={styles.topEnd}>
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
                  e.currentTarget.defaultPlaybackRate = speed
                  e.currentTarget.playbackRate = speed
                }}
                onError={(e) => {
                  if (e.currentTarget.error && currentSource) {
                    onError(unplayableMessage(currentSource.name))
                  }
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

          <Timeline
            sources={sources}
            urls={urls}
            clips={clips}
            selectedId={selectedId}
            openStart={openStart}
            location={location}
            currentTime={player.currentTime}
            duration={duration}
            onSeekLocal={player.seekLocal}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onTrim={(clip) => dispatch({ type: 'updateClip', clip })}
            onDragStart={pauseForDrag}
            onDragEnd={resumeAfterDragEnd}
            onRemoveSource={removeSource}
            onMoveSource={(from, to) => dispatch({ type: 'moveSource', from, to })}
            onAddFiles={(picked) => void addFiles(picked)}
          />

          <TransportBar
            paused={player.paused}
            marking={openStart !== null}
            clipLabel={clips.length === 0 ? null : `Clip ${Math.max(labelIndex, 0) + 1}`}
            hasClips={clips.length > 0}
            speed={speed}
            onTogglePlay={togglePlay}
            onSeekBy={(seconds) => player.seek(now() + seconds)}
            onPrevClip={() => goToClip(prevClipIndex(sequenceClips, now(), selectedId))}
            onNextClip={() => goToClip(nextClipIndex(sequenceClips, now(), selectedId))}
            onOpenClip={openInEditor}
            onMark={mark}
            onSpeed={setSpeed}
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
          {selectedClip && selectedSource && (
            <ClipEditor
              key={selectedClip.id}
              ref={editorRef}
              clip={selectedClip}
              number={selectedIndex + 1}
              source={selectedSource}
              url={urls.get(selectedSource.id)}
              playhead={currentSource?.id === selectedSource.id ? location.localTime : null}
              onSeek={seekInSelectedSource}
              onChange={(clip) => dispatch({ type: 'updateClip', clip })}
              onDragStart={pauseForDrag}
              onDragEnd={resumeAfterDragEnd}
              onPreview={(clip) => {
                const start = sequenceStart(clip)
                player.playRange(start, start + (clip.end - clip.start))
              }}
              onDelete={deleteClip}
            />
          )}
        </aside>
      </main>

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}
      {joinOpen && (
        <JoinDialog
          sources={sources.flatMap((meta) => {
            const file = files.file(meta.id)
            return file ? [{ meta, file }] : []
          })}
          clips={clips}
          onClose={() => setJoinOpen(false)}
        />
      )}
    </div>
  )
}

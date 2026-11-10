import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { EditorInput, LoadedSource } from '../App'
import { ChevronRight, Trash, Volleyball } from '../components/Icons'
import { ShortcutsModal } from '../components/ShortcutsModal'
import ui from '../components/ui.module.css'
import { formatBytes } from '../lib/bytes'
import { totalClippedDuration } from '../lib/clips'
import { fingerprint } from '../lib/fingerprint'
import { clearSessions, loadSession, type SavedSession } from '../lib/persistence'
import { locate, toSequence } from '../lib/sequence'
import { formatTime } from '../lib/time'
import { loadSource } from '../media/loadSource'
import { unplayableMessage } from '../playable'
import { browserStore } from '../storage'
import styles from './Home.module.css'

type Props = {
  onOpen: (input: EditorInput) => void
  error: string | null
  onError: (message: string | null) => void
}

type PickMode = 'new' | 'continue'

/** Probes every file in order; reports the first one the browser cannot play. */
async function loadAll(files: File[]): Promise<LoadedSource[] | string> {
  const loaded = await Promise.all(files.map(loadSource))
  const failed = loaded.findIndex((source) => source === null)
  if (failed >= 0) return unplayableMessage(files[failed].name)
  return loaded as LoadedSource[]
}

/** The saved playhead moved to where its source sits once missing sources are dropped. */
function keptPlayhead(saved: SavedSession, kept: readonly LoadedSource[]): number {
  const { index, localTime } = locate(saved.sources, saved.playhead)
  const id = saved.sources[index]?.id
  const keptIndex = kept.findIndex((s) => s.meta.id === id)
  if (keptIndex < 0) return 0
  return toSequence(
    kept.map((s) => s.meta),
    keptIndex,
    localTime,
  )
}

export function Home({ onOpen, error, onError }: Props) {
  const [saved, setSaved] = useState<SavedSession | null>(() => {
    const store = browserStore()
    return store ? loadSession(store) : null
  })
  const [found, setFound] = useState<ReadonlyMap<string, File>>(new Map())
  const [continuing, setContinuing] = useState(false)
  const [mismatch, setMismatch] = useState<File | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickMode = useRef<PickMode>('new')

  useEffect(() => {
    if (!confirmDelete) return
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmDelete])

  const openPicker = (mode: PickMode) => {
    pickMode.current = mode
    const input = inputRef.current
    if (!input) return
    input.multiple = mode === 'continue'
    input.click()
  }

  const openNew = async (file: File) => {
    const loaded = await loadAll([file])
    if (typeof loaded === 'string') onError(loaded)
    else onOpen({ sources: loaded, clips: [], playhead: 0 })
  }

  /** Opens the saved session with the sources that have a file; the others and their clips go. */
  const openSaved = async (session: SavedSession, files: ReadonlyMap<string, File>) => {
    const picked = session.sources.flatMap((s) => {
      const file = files.get(s.id)
      return file ? [file] : []
    })
    const loaded = await loadAll(picked)
    if (typeof loaded === 'string') {
      onError(loaded)
      return
    }
    const ids = new Set(loaded.map((s) => s.meta.id))
    onOpen({
      sources: loaded,
      clips: session.clips.filter((c) => ids.has(c.sourceId)),
      playhead: keptPlayhead(session, loaded),
    })
  }

  /** "Use it anyway": the one saved source is replaced by a different file, clips and all. */
  const openWithReplacement = async (session: SavedSession, file: File) => {
    const loaded = await loadAll([file])
    if (typeof loaded === 'string') {
      onError(loaded)
      return
    }
    const id = loaded[0].meta.id
    onOpen({
      sources: loaded,
      clips: session.clips.map((c) => ({ ...c, sourceId: id })),
      playhead: session.playhead,
    })
  }

  const addMatches = (session: SavedSession, files: File[]) => {
    const ids = new Set(session.sources.map((s) => s.id))
    const next = new Map(found)
    for (const file of files) {
      const id = fingerprint(file)
      if (ids.has(id)) next.set(id, file)
    }
    const matchedNone = files.every((file) => !ids.has(fingerprint(file)))
    if (session.sources.length === 1 && matchedNone && files.length > 0) {
      setMismatch(files[0])
      return
    }
    setMismatch(null)
    setFound(next)
    setContinuing(true)
    if (session.sources.every((s) => next.has(s.id))) void openSaved(session, next)
  }

  const handleFiles = (files: File[], mode: PickMode) => {
    onError(null)
    if (files.length === 0) return
    const matchesSaved =
      saved !== null && files.some((f) => saved.sources.some((s) => s.id === fingerprint(f)))
    if (saved && (mode === 'continue' || matchesSaved)) addMatches(saved, files)
    else void openNew(files[0])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFiles([file], 'new')
  }

  const deleteSaved = () => {
    const store = browserStore()
    if (store) clearSessions(store)
    setSaved(null)
    setConfirmDelete(false)
    setMismatch(null)
    setContinuing(false)
    setFound(new Map())
  }

  const missing = saved && continuing ? saved.sources.filter((s) => !found.has(s.id)) : []

  return (
    <main
      className={`${styles.page} ${dragging ? styles.dragging : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Volleyball size={96} />
      <h1 className={styles.title}>VBClipper</h1>
      <p className={styles.subtitle}>Select a volleyball video to start clipping points</p>

      <button
        type="button"
        className={`${ui.pill} ${styles.choose}`}
        onClick={() => openPicker('new')}
      >
        Choose Video
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        data-testid="home-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          handleFiles(files, pickMode.current)
        }}
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {saved && (
        <div className={styles.card}>
          <button type="button" className={styles.cardMain} onClick={() => openPicker('continue')}>
            <span className={styles.cardText}>
              <span className={styles.cardTitle}>Continue Session</span>
              <span className={styles.cardSub}>
                {saved.clips.length} {saved.clips.length === 1 ? 'clip' : 'clips'} ·{' '}
                {formatTime(totalClippedDuration(saved.clips))} clipped
              </span>
            </span>
            <ChevronRight className={styles.chevron} />
          </button>
          {confirmDelete ? (
            <button type="button" className={styles.confirmDelete} onClick={deleteSaved}>
              Delete?
            </button>
          ) : (
            <button
              type="button"
              className={styles.trash}
              aria-label="Delete saved session"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash />
            </button>
          )}
        </div>
      )}

      {saved && !mismatch && missing.length === 0 && (
        <p className={styles.hint}>
          {saved.sources.length > 1
            ? `Pick the same ${saved.sources.length} video files again to continue.`
            : 'Pick the same video file again to continue.'}
        </p>
      )}

      {saved && !mismatch && missing.length > 0 && (
        <div className={styles.mismatch} role="status">
          <p>Still needed: {missing.map((s) => s.name).join(', ')}</p>
          <div className={styles.mismatchActions}>
            <button type="button" className={ui.pillSmall} onClick={() => openPicker('continue')}>
              Pick files
            </button>
            {found.size > 0 && (
              <button
                type="button"
                className={ui.pillSecondary + ' ' + styles.small}
                onClick={() => void openSaved(saved, found)}
              >
                Open without them
              </button>
            )}
          </div>
        </div>
      )}

      {saved && mismatch && (
        <div className={styles.mismatch} role="alert">
          <p>
            That doesn’t look like the same video (expected {saved.sources[0].name},{' '}
            {formatBytes(saved.sources[0].size)})
          </p>
          <div className={styles.mismatchActions}>
            <button
              type="button"
              className={ui.pillSmall}
              onClick={() => void openWithReplacement(saved, mismatch)}
            >
              Use it anyway
            </button>
            <button
              type="button"
              className={ui.pillSecondary + ' ' + styles.small}
              onClick={() => openPicker('continue')}
            >
              Pick another
            </button>
          </div>
        </div>
      )}

      <button type="button" className={ui.linkButton} onClick={() => setShowHelp(true)}>
        How it works
      </button>

      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}
    </main>
  )
}

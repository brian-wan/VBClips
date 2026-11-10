import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { EditorInput, LoadedSource } from '../App'
import { ChevronRight, Trash, Volleyball } from '../components/Icons'
import { ProgressLine } from '../components/ProgressLine'
import { ShortcutsModal } from '../components/ShortcutsModal'
import ui from '../components/ui.module.css'
import { formatBytes } from '../lib/bytes'
import { totalClippedDuration } from '../lib/clips'
import { fingerprint } from '../lib/fingerprint'
import { openingLabel, type Opening } from '../lib/opening'
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

/** Probes every file; reports the first one the browser cannot play. */
async function loadAll(files: File[], onEach: () => void): Promise<LoadedSource[] | string> {
  const loaded = await Promise.all(
    files.map(async (file) => {
      const source = await loadSource(file)
      onEach()
      return source
    }),
  )
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
  /** Files being probed and which control started it; both controls are disabled meanwhile. */
  const [opening, setOpening] = useState<(Opening & { from: PickMode }) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickMode = useRef<PickMode>('new')

  useEffect(() => {
    if (!confirmDelete) return
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmDelete])

  /** Probes `files` while the control named by `from` shows the opening state. */
  const probe = async (files: File[], from: PickMode) => {
    setOpening({ names: files.map((f) => f.name), done: 0, from })
    try {
      return await loadAll(files, () =>
        setOpening((current) => current && { ...current, done: current.done + 1 }),
      )
    } finally {
      setOpening(null)
    }
  }

  const openPicker = (mode: PickMode) => {
    pickMode.current = mode
    const input = inputRef.current
    if (!input) return
    input.multiple = mode === 'continue'
    input.click()
  }

  const openNew = async (file: File) => {
    const loaded = await probe([file], 'new')
    if (typeof loaded === 'string') onError(loaded)
    else onOpen({ sources: loaded, clips: [], playhead: 0 })
  }

  /** Opens the saved session with the sources that have a file; the others and their clips go. */
  const openSaved = async (session: SavedSession, files: ReadonlyMap<string, File>) => {
    const picked = session.sources.flatMap((s) => {
      const file = files.get(s.id)
      return file ? [file] : []
    })
    const loaded = await probe(picked, 'continue')
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
    const loaded = await probe([file], 'continue')
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
    if (opening) return
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

      <div className={styles.choose}>
        <button
          type="button"
          className={`${ui.primary} ${styles.chooseButton}`}
          disabled={opening !== null}
          onClick={() => openPicker('new')}
        >
          <span className={styles.ellipsis}>
            {opening?.from === 'new' ? openingLabel(opening.names, opening.done) : 'Choose Video'}
          </span>
        </button>
        {opening?.from === 'new' && (
          <ProgressLine
            value={opening.names.length > 1 ? opening.done / opening.names.length : null}
            className={styles.openingLine}
            label="Opening video"
          />
        )}
      </div>
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
          <button
            type="button"
            className={styles.cardMain}
            disabled={opening !== null}
            onClick={() => openPicker('continue')}
          >
            <span className={styles.cardText}>
              <span className={`${styles.cardTitle} ${styles.ellipsis}`}>
                {opening?.from === 'continue'
                  ? openingLabel(opening.names, opening.done)
                  : 'Continue Session'}
              </span>
              <span className={styles.cardSub}>
                {saved.clips.length} {saved.clips.length === 1 ? 'clip' : 'clips'} ·{' '}
                {formatTime(totalClippedDuration(saved.clips))} clipped
              </span>
            </span>
            <ChevronRight size={16} className={styles.chevron} />
          </button>
          {confirmDelete ? (
            <button
              type="button"
              className={`${ui.destructive} ${ui.small} ${styles.confirmDelete}`}
              onClick={deleteSaved}
            >
              Delete?
            </button>
          ) : (
            <button
              type="button"
              className={`${ui.iconButton} ${styles.trash}`}
              aria-label="Delete saved session"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash size={18} />
            </button>
          )}
          {opening?.from === 'continue' && (
            <ProgressLine
              value={opening.names.length > 1 ? opening.done / opening.names.length : null}
              className={styles.openingLine}
              label="Opening videos"
            />
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
            <button
              type="button"
              className={`${ui.primary} ${ui.small}`}
              onClick={() => openPicker('continue')}
            >
              Pick files
            </button>
            {found.size > 0 && (
              <button
                type="button"
                className={`${ui.secondary} ${ui.small}`}
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
              className={`${ui.primary} ${ui.small}`}
              onClick={() => void openWithReplacement(saved, mismatch)}
            >
              Use it anyway
            </button>
            <button
              type="button"
              className={`${ui.secondary} ${ui.small}`}
              onClick={() => openPicker('continue')}
            >
              Pick another
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`${ui.linkButton} ${styles.help}`}
        onClick={() => setShowHelp(true)}
      >
        How it works
      </button>

      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}
    </main>
  )
}

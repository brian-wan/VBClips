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
import { matchSavedSources } from '../lib/resume'
import { keptPlayhead } from '../lib/sequence'
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

type Loaded = { sources: LoadedSource[] } | { error: string; failedIds: string[] }

/** Probes every file; on failure, names the first one the browser cannot play and lists all. */
async function loadAll(files: File[], onEach: () => void): Promise<Loaded> {
  const loaded = await Promise.all(
    files.map(async (file) => {
      const source = await loadSource(file)
      onEach()
      return source
    }),
  )
  const sources = loaded.filter((source) => source !== null)
  const failed = files.filter((_, i) => loaded[i] === null)
  const first = failed[0]
  if (!first) return { sources }
  return { error: unplayableMessage(first.name), failedIds: failed.map(fingerprint) }
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

  /** Set synchronously, so a second click before the next render cannot start another probe. */
  const probing = useRef(false)

  /**
   * Probes `files` while the control named by `from` shows the opening state. Resolves to null
   * without probing when another probe is still running.
   */
  const probe = async (files: File[], from: PickMode) => {
    if (probing.current) return null
    probing.current = true
    setOpening({ names: files.map((f) => f.name), done: 0, from })
    try {
      return await loadAll(files, () =>
        setOpening((current) => current && { ...current, done: current.done + 1 }),
      )
    } finally {
      probing.current = false
      setOpening(null)
    }
  }

  const openPicker = (mode: PickMode) => {
    if (probing.current) return
    pickMode.current = mode
    const input = inputRef.current
    if (!input) return
    input.multiple = mode === 'continue'
    input.click()
  }

  const openNew = async (file: File) => {
    const loaded = await probe([file], 'new')
    if (loaded === null) return
    if ('error' in loaded) onError(loaded.error)
    else onOpen({ sources: loaded.sources, clips: [], playhead: 0 })
  }

  /** Opens the saved session with the sources that have a file; the others and their clips go. */
  const openSaved = async (session: SavedSession, files: ReadonlyMap<string, File>) => {
    const picked = session.sources.flatMap((s) => {
      const file = files.get(s.id)
      return file ? [file] : []
    })
    const loaded = await probe(picked, 'continue')
    if (loaded === null) return
    if ('error' in loaded) {
      // The files that failed are needed again, so the user can pick others or open without them.
      const failed = new Set(loaded.failedIds)
      setFound(new Map([...files].filter(([id]) => !failed.has(id))))
      onError(loaded.error)
      return
    }
    const ids = new Set(loaded.sources.map((s) => s.meta.id))
    onOpen({
      sources: loaded.sources,
      clips: session.clips.filter((c) => ids.has(c.sourceId)),
      playhead: keptPlayhead(
        session,
        loaded.sources.map((s) => s.meta),
      ),
    })
  }

  /** "Use it anyway": the one saved source is replaced by a different file, clips and all. */
  const openWithReplacement = async (session: SavedSession, file: File) => {
    const loaded = await probe([file], 'continue')
    if (loaded === null) return
    const replacement = 'error' in loaded ? undefined : loaded.sources[0]
    if (!replacement) {
      onError('error' in loaded ? loaded.error : unplayableMessage(file.name))
      return
    }
    const id = replacement.meta.id
    onOpen({
      sources: [replacement],
      clips: session.clips.map((c) => ({ ...c, sourceId: id })),
      playhead: session.playhead,
    })
  }

  const addMatches = (session: SavedSession, files: File[]) => {
    const match = matchSavedSources(session, found, files)
    if (match.kind === 'mismatch') {
      setMismatch(match.file)
      return
    }
    setMismatch(null)
    setFound(match.found)
    setContinuing(true)
    if (match.complete) void openSaved(session, match.found)
  }

  const handleFiles = (files: File[], mode: PickMode) => {
    if (opening) return
    onError(null)
    const [first] = files
    if (!first) return
    const matchesSaved =
      saved !== null && files.some((f) => saved.sources.some((s) => s.id === fingerprint(f)))
    if (saved && (mode === 'continue' || matchesSaved)) addMatches(saved, files)
    else void openNew(first)
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
  /** The one saved source a mismatched file was compared with. */
  const expected = saved?.sources[0]

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
      <p className={styles.privacy}>Your videos never leave this computer.</p>

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
              disabled={opening !== null}
              onClick={() => openPicker('continue')}
            >
              Pick files
            </button>
            {found.size > 0 && (
              <button
                type="button"
                className={`${ui.secondary} ${ui.small}`}
                disabled={opening !== null}
                onClick={() => void openSaved(saved, found)}
              >
                Open without them
              </button>
            )}
          </div>
        </div>
      )}

      {saved && mismatch && expected && (
        <div className={styles.mismatch} role="alert">
          <p>
            That doesn’t look like the same video (expected {expected.name},{' '}
            {formatBytes(expected.size)})
          </p>
          <div className={styles.mismatchActions}>
            <button
              type="button"
              className={`${ui.primary} ${ui.small}`}
              disabled={opening !== null}
              onClick={() => void openWithReplacement(saved, mismatch)}
            >
              Use it anyway
            </button>
            <button
              type="button"
              className={`${ui.secondary} ${ui.small}`}
              disabled={opening !== null}
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

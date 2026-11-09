import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { EditorInput } from '../App'
import { ChevronRight, Trash, Volleyball } from '../components/Icons'
import { ShortcutsModal } from '../components/ShortcutsModal'
import ui from '../components/ui.module.css'
import { formatBytes } from '../lib/bytes'
import { totalClippedDuration } from '../lib/clips'
import { sameVideo } from '../lib/fingerprint'
import { clearSessions, loadSession, type SavedSession } from '../lib/persistence'
import { formatTime } from '../lib/time'
import { canProbablyPlay, unplayableMessage } from '../playable'
import { browserStore } from '../storage'
import styles from './Home.module.css'

type Props = {
  onOpen: (input: EditorInput) => void
  error: string | null
  onError: (message: string | null) => void
}

type PickMode = 'new' | 'continue'

export function Home({ onOpen, error, onError }: Props) {
  const [saved, setSaved] = useState<SavedSession | null>(() => {
    const store = browserStore()
    return store ? loadSession(store) : null
  })
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
    inputRef.current?.click()
  }

  const openWithSaved = (file: File, session: SavedSession) =>
    onOpen({ file, clips: session.clips, playhead: session.playhead })

  const handleFile = (file: File, mode: PickMode) => {
    setMismatch(null)
    if (!canProbablyPlay(file)) {
      onError(unplayableMessage(file.name))
      return
    }
    onError(null)
    if (saved && sameVideo(saved.video, file)) {
      openWithSaved(file, saved)
    } else if (mode === 'continue' && saved) {
      setMismatch(file)
    } else {
      onOpen({ file, clips: [], playhead: 0 })
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file, 'new')
  }

  const deleteSaved = () => {
    const store = browserStore()
    if (store) clearSessions(store)
    setSaved(null)
    setConfirmDelete(false)
    setMismatch(null)
  }

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
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) handleFile(file, pickMode.current)
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

      {saved && !mismatch && (
        <p className={styles.hint}>Pick the same video file again to continue.</p>
      )}

      {saved && mismatch && (
        <div className={styles.mismatch} role="alert">
          <p>
            That doesn’t look like the same video (expected {saved.video.name},{' '}
            {formatBytes(saved.video.size)})
          </p>
          <div className={styles.mismatchActions}>
            <button
              type="button"
              className={ui.pillSmall}
              onClick={() => openWithSaved(mismatch, saved)}
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

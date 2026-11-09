import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
  closeLabel?: string
}

/**
 * Centered modal. Closes on Esc, a click outside, or Done. While open it swallows keyboard events
 * so page shortcuts (Space to mark, arrows to seek) do not fire behind it.
 */
export function Dialog({ title, onClose, children, width, closeLabel = 'Done' }: Props) {
  const doneRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    doneRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button ref={doneRef} type="button" className={styles.done} onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  )
}

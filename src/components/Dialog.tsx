import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import styles from './Dialog.module.css'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
  closeLabel?: string
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Centered modal. Closes on Esc, a press and release both outside it, or Done. Tab stays inside.
 * On open it focuses the content's primary action (a control with `autoFocus`), else Done, and on
 * close it gives focus back to whatever had it before. The editor's shortcuts are switched off by
 * the editor while a dialog is open.
 */
export function Dialog({ title, onClose, children, width, closeLabel = 'Done' }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const pressedBackdrop = useRef(false)
  // Read before the content mounts, since an `autoFocus` control takes focus as it does.
  const [opener] = useState(() => document.activeElement)

  useLayoutEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) {
      doneRef.current?.focus({ preventScroll: true })
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [opener])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const dialog = e.currentTarget
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || active === dialog)) {
      e.preventDefault()
      first.focus()
    }
  }

  const onBackdropDown = (e: PointerEvent<HTMLDivElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget
  }
  const onBackdropUp = (e: PointerEvent<HTMLDivElement>) => {
    const outside = pressedBackdrop.current && e.target === e.currentTarget
    pressedBackdrop.current = false
    if (outside) onClose()
  }

  return (
    <div className={styles.backdrop} onPointerDown={onBackdropDown} onPointerUp={onBackdropUp}>
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        onKeyDown={onKeyDown}
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

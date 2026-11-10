import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import styles from './Dialog.module.css'
import ui from './ui.module.css'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
  closeLabel?: string
  /** Fill the screen under 700px wide, with 44px buttons. */
  fullScreenOnPhone?: boolean
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Centered modal. Closes on Esc, a press and release both outside it, or Done. Tab stays inside.
 * On open it focuses the content's primary action (a control with `autoFocus`), else Done, and on
 * close it gives focus back to whatever had it before. The editor's shortcuts are switched off by
 * the editor while a dialog is open.
 */
export function Dialog({
  title,
  onClose,
  children,
  width,
  closeLabel = 'Done',
  fullScreenOnPhone = false,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const pressedBackdrop = useRef(false)
  // Read before the content mounts, since an `autoFocus` control takes focus as it does.
  const [opener] = useState(() => document.activeElement)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog?.contains(document.activeElement)) doneRef.current?.focus({ preventScroll: true })
    return () => {
      // Only once the dialog has really left the page: React's development mode also runs this
      // cleanup for a dialog that stays mounted.
      queueMicrotask(() => {
        if (dialog?.isConnected) return
        if (opener instanceof HTMLElement && opener.isConnected)
          opener.focus({ preventScroll: true })
      })
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
  // A press on the backdrop would otherwise focus <body>, and a dialog left open after it would
  // lose Tab and Escape, which both live on the dialog.
  const keepFocusInside = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) e.preventDefault()
  }
  const onBackdropUp = (e: PointerEvent<HTMLDivElement>) => {
    const outside = pressedBackdrop.current && e.target === e.currentTarget
    pressedBackdrop.current = false
    if (outside) onClose()
  }

  return (
    <div
      className={`${styles.backdrop} ${fullScreenOnPhone ? styles.fullScreen : ''}`}
      onPointerDown={onBackdropDown}
      onPointerUp={onBackdropUp}
      onMouseDown={keepFocusInside}
    >
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
          <button ref={doneRef} type="button" className={ui.textButton} onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  )
}

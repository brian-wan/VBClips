import type { ReactNode } from 'react'
import styles from './Sheet.module.css'

type Props = {
  title: string
  onClose: () => void
  /** Bottom sheet on narrow screens; becomes a right-side drawer on desktop. */
  drawerOnDesktop?: boolean
  children: ReactNode
  headerExtra?: ReactNode
}

export function Sheet({ title, onClose, drawerOnDesktop, children, headerExtra }: Props) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <section
        className={drawerOnDesktop ? styles.drawer : styles.sheet}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} />
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {headerExtra}
          <button type="button" className={styles.done} onClick={onClose}>
            Done
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  )
}

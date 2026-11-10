import type { Toast } from '../hooks/useToasts'
import styles from './Toasts.module.css'
import ui from './ui.module.css'

type Props = { toasts: Toast[]; onDismiss: (id: number) => void }

export function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className={`${ui.textButton} ${styles.action}`}
              onClick={() => {
                toast.action?.onClick()
                onDismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

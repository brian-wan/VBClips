import { SHORTCUTS } from '../lib/shortcuts'
import { Dialog } from './Dialog'
import styles from './ShortcutsModal.module.css'

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="How it works" onClose={onClose}>
      <div className={styles.content}>
        <p className={styles.intro}>
          Play the video and press Space when a point starts and again when it ends. Each pair of
          presses saves a clip. Later, join the clips into one video with the dead time removed.
        </p>
        <table className={styles.table}>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td className={styles.keys}>{s.keys}</td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}

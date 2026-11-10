import { SHORTCUTS } from '../lib/shortcuts'
import { Dialog } from './Dialog'
import styles from './ShortcutsModal.module.css'
import ui from './ui.module.css'

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
              <tr key={s.action}>
                <td className={styles.keys}>
                  <span className={styles.keyList}>
                    {s.keys.map((part, i) =>
                      typeof part === 'string' ? (
                        <kbd key={i} className={ui.kbd}>
                          {part}
                        </kbd>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </span>
                </td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}

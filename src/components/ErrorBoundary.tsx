import { Component, type ErrorInfo, type ReactNode } from 'react'
import ui from './ui.module.css'
import styles from './ErrorBoundary.module.css'

type Props = { children: ReactNode; onHome: () => void }
type State = { error: Error | null }

/**
 * Catches a render error in the screen it wraps. The editor saves on unmount, so by the time this
 * shows, the clips are in storage and Home offers Continue Session.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className={styles.page} role="alert">
        <p className={styles.message}>Something went wrong. Your clips are saved.</p>
        <details className={styles.details}>
          <summary>Error details</summary>
          <pre className={styles.trace}>{error.message}</pre>
        </details>
        <button type="button" className={ui.primary} onClick={this.props.onHome}>
          Back to Home
        </button>
      </main>
    )
  }
}

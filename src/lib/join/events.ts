import type { JoinEvent } from './runner'

/** What the Join dialog shows while a join runs. */
export type RunningView = {
  event: JoinEvent
  /** The join switched from Fast to Precise; the dialog says why until it closes. */
  fellBack: boolean
  /** The latest log line while the core loads, shown under the bar (e.g. the single-thread note). */
  loadingLog: string | null
}

const loading = (event: JoinEvent) => event.phase === 'download' || event.phase === 'start'

/**
 * The dialog's view after `event`, or null when the event changes nothing it shows. ffmpeg's own
 * log lines arrive as events too; once the core has loaded they are kept for the error state and
 * not shown, so they are dropped here.
 */
export function applyJoinEvent(view: RunningView, event: JoinEvent): RunningView | null {
  if (event.log && !loading(event) && event.phase !== 'fallback') return null
  return {
    event,
    fellBack: view.fellBack || event.phase === 'fallback',
    loadingLog: event.log && loading(event) ? event.log : view.loadingLog,
  }
}

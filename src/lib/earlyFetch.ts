/** Without `requestIdleCallback` (Safari), the early fetch waits this long instead. */
export const IDLE_FALLBACK_MS = 2000

export type IdleEnvironment = {
  requestIdleCallback?: ((callback: () => void) => number) | undefined
  cancelIdleCallback?: ((id: number) => void) | undefined
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  /** The user asked for reduced data use (`navigator.connection.saveData`). */
  saveData: boolean
}

/**
 * Runs `task` once at the page's first idle moment, or after 2 s where the browser has no idle
 * callback. Does nothing when the user asked to save data. The returned function cancels a task
 * that has not run yet.
 */
export function whenIdle(task: () => void, env: IdleEnvironment): () => void {
  if (env.saveData) return () => undefined
  const { requestIdleCallback, cancelIdleCallback } = env
  if (requestIdleCallback && cancelIdleCallback) {
    const id = requestIdleCallback(task)
    return () => cancelIdleCallback(id)
  }
  const id = env.setTimeout(task, IDLE_FALLBACK_MS)
  return () => env.clearTimeout(id)
}

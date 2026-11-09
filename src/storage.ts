import type { KeyValueStore } from './lib/persistence'

/** localStorage, or null when the browser blocks it (private mode, disabled site data). */
export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

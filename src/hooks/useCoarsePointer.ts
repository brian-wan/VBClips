import { useSyncExternalStore } from 'react'
import { COARSE_POINTER_QUERY, isCoarsePointer } from '../lib/pointer'

const subscribe = (onChange: () => void) => {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(COARSE_POINTER_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True while the primary pointer is a finger; follows a tablet gaining or losing a mouse. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer)
}

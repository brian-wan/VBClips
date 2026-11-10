import { useRegisterSW } from 'virtual:pwa-register/react'
import type { Toast } from './useToasts'

/** `useToasts` ids start at 1, so this one never collides with a screen's own toasts. */
const UPDATE_TOAST_ID = 0

/**
 * The "A new version is ready" toast while a new service worker is waiting, else null. Nothing
 * reloads until the user presses Reload, so an update never interrupts a join.
 */
export function useUpdateToast(beforeReload: () => void): Toast | null {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return {
    id: UPDATE_TOAST_ID,
    message: 'A new version is ready',
    action: {
      label: 'Reload',
      onClick: () => {
        beforeReload()
        void updateServiceWorker()
      },
    },
  }
}

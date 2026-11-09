import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastAction = { label: string; onClick: () => void }
export type Toast = { id: number; message: string; action?: ToastAction }

const DEFAULT_TIMEOUT = 2500

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((all) => all.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, options?: { action?: ToastAction; timeout?: number }) => {
      const id = nextId.current++
      setToasts((all) => [...all.filter((t) => t.message !== message), { id, message, ...options }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), options?.timeout ?? DEFAULT_TIMEOUT),
      )
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => window.clearTimeout(timer))
  }, [])

  return { toasts, show, dismiss }
}

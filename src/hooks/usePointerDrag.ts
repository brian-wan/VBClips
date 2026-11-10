import { useEffect, useRef, useState, type PointerEvent } from 'react'

export type PointerDragHandlers<E extends Element> = {
  onMove: (event: PointerEvent<E>) => void
  /** The pointer was released over the page: the drag's result stands. */
  onCommit: (event: PointerEvent<E>) => void
  /** Escape, a cancelled pointer, lost capture or the window losing focus. */
  onCancel: () => void
}

type Active = { pointerId: number; target: Element }

/**
 * One pointer-capture drag at a time. `begin` captures the pointer that went down; the returned
 * props route its moves and its release to the handlers, matching the pointer id. Escape (which
 * then goes no further), `pointercancel`, a capture lost to something other than our own release,
 * and the window losing focus all end the drag through `onCancel`, so a drag can never be left
 * running.
 */
export function usePointerDrag<E extends Element>(handlers: PointerDragHandlers<E>) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const active = useRef<Active | null>(null)
  const [dragging, setDragging] = useState(false)

  /** Clears the drag before releasing capture, so our own release is not taken as a loss. */
  const end = () => {
    const current = active.current
    if (!current) return false
    active.current = null
    setDragging(false)
    if (current.target.hasPointerCapture(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId)
    }
    return true
  }

  const cancel = () => {
    if (end()) latest.current.onCancel()
  }
  const cancelRef = useRef(cancel)
  useEffect(() => {
    cancelRef.current = cancel
  })

  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancelRef.current()
    }
    const onBlur = () => cancelRef.current()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [dragging])

  const owns = (e: PointerEvent<E>) => active.current?.pointerId === e.pointerId

  const begin = (e: PointerEvent<E>) => {
    if (active.current) cancel()
    e.currentTarget.setPointerCapture(e.pointerId)
    active.current = { pointerId: e.pointerId, target: e.currentTarget }
    setDragging(true)
  }

  const props = {
    onPointerMove: (e: PointerEvent<E>) => {
      if (owns(e)) latest.current.onMove(e)
    },
    onPointerUp: (e: PointerEvent<E>) => {
      if (owns(e) && end()) latest.current.onCommit(e)
    },
    onPointerCancel: (e: PointerEvent<E>) => {
      if (owns(e)) cancel()
    },
    onLostPointerCapture: (e: PointerEvent<E>) => {
      if (owns(e)) cancel()
    },
  }

  return { begin, cancel, dragging, props }
}

import { useEffect, useState, type RefObject } from 'react'
import { shouldRelayout } from '../lib/filmstrip'

/** Hold back width changes until they exceed `by` px, then apply them after `delayMs`. */
export type Settle = { by: number; delayMs: number }

/**
 * Width of `ref`'s content box, kept current with a ResizeObserver. With `settle`, the first
 * width applies at once and later ones only once they differ by more than `settle.by`, after
 * `settle.delayMs`, so a filmstrip is not laid out again for every pixel of a resize.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, settle?: Settle): number {
  const [width, setWidth] = useState(0)
  const by = settle?.by
  const delayMs = settle?.delayMs ?? 0
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    let applied = 0
    const apply = (next: number) => {
      applied = next
      setWidth(next)
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = entry.contentRect.width
      window.clearTimeout(timer)
      if (by === undefined || applied === 0) apply(next)
      else if (shouldRelayout(applied, next, by)) {
        timer = window.setTimeout(() => apply(next), delayMs)
      }
    })
    observer.observe(el)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [ref, by, delayMs])
  return width
}

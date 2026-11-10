import { useEffect, useRef } from 'react'

export type EditorShortcutHandlers = {
  mark: () => void
  togglePlay: () => void
  seekBy: (seconds: number) => void
  prevClip: () => void
  nextClip: () => void
  cycleSpeed: () => void
  editSelected: () => void
  deleteSelected: () => void
  undo: () => void
  redo: () => void
  escape: () => void
  showShortcuts: () => void
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'number',
  'password',
  'tel',
  'url',
  'date',
  'time',
])

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)
}

const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' '

/**
 * All editor keyboard bindings. Space always means "mark": it is swallowed on keydown and keyup
 * so it never scrolls or activates a focused button, and buttons are blurred after each click.
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return
      const h = ref.current
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.code === 'KeyZ' && !e.altKey) {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
        return
      }
      if (mod || e.altKey) return

      if (isSpace(e)) {
        e.preventDefault()
        if (!e.repeat) h.mark()
        return
      }

      const handled = dispatchKey(e, h)
      if (handled) e.preventDefault()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isSpace(e) && !isTextInput(e.target)) e.preventDefault()
    }

    const onClick = () => {
      const active = document.activeElement
      if (active instanceof HTMLButtonElement || active?.getAttribute('role') === 'button') {
        ;(active as HTMLElement).blur()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('click', onClick)
    }
  }, [])
}

function dispatchKey(e: KeyboardEvent, h: EditorShortcutHandlers): boolean {
  switch (e.key) {
    case 'ArrowLeft':
      h.seekBy(-5)
      return true
    case 'ArrowRight':
      h.seekBy(5)
      return true
    case 'ArrowUp':
    case '[':
      h.prevClip()
      return true
    case 'ArrowDown':
    case ']':
      h.nextClip()
      return true
    case 'Delete':
    case 'Backspace':
      h.deleteSelected()
      return true
    case 'Escape':
      h.escape()
      return true
    case '?':
      h.showShortcuts()
      return true
  }
  switch (e.key.toLowerCase()) {
    case 'k':
      h.togglePlay()
      return true
    case 's':
      h.cycleSpeed()
      return true
    case 'e':
      h.editSelected()
      return true
  }
  return false
}

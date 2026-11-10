import { useEffect, useRef } from 'react'
import { dispatchKey, isSpace, isTextInput, type EditorShortcutHandlers } from '../lib/keys'

/**
 * All editor keyboard bindings. Space always means "mark": it is swallowed on keydown and keyup
 * so it never scrolls or activates a focused button, and buttons are blurred after each click.
 * While `disabled` (a dialog is open) every key goes to the page as usual.
 */
export function useEditorShortcuts(
  handlers: EditorShortcutHandlers,
  { disabled }: { disabled: boolean },
): void {
  const ref = useRef({ handlers, disabled })
  useEffect(() => {
    ref.current = { handlers, disabled }
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (ref.current.disabled || isTextInput(e.target)) return
      if (dispatchKey(e, ref.current.handlers)) e.preventDefault()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (ref.current.disabled) return
      if (isSpace(e) && !isTextInput(e.target)) e.preventDefault()
    }

    // Focus inside a dialog stays put: the dialog manages it.
    const onClick = () => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || active.closest('[role="dialog"]')) return
      if (active instanceof HTMLButtonElement || active.getAttribute('role') === 'button') {
        active.blur()
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

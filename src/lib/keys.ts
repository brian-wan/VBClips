/** What each editor key does; `dispatchKey` maps a key press to one of these. */
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

/** Typing in these never triggers a shortcut. */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)
}

/** The parts of a key press the bindings read, so they can be tested without a DOM event. */
export type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'code' | 'repeat' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
>

export const isSpace = (e: Pick<KeyPress, 'key' | 'code'>) => e.code === 'Space' || e.key === ' '

/**
 * Runs the handler bound to `e` and says whether the key was the editor's, in which case the
 * caller swallows it. Space is always the editor's, but a held Space marks only once; Cmd/Ctrl+Z
 * undoes and Shift+Cmd/Ctrl+Z redoes; any other chord with a modifier is left to the browser.
 */
export function dispatchKey(e: KeyPress, h: EditorShortcutHandlers): boolean {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.code === 'KeyZ' && !e.altKey) {
    if (e.shiftKey) h.redo()
    else h.undo()
    return true
  }
  if (mod || e.altKey) return false
  if (isSpace(e)) {
    if (!e.repeat) h.mark()
    return true
  }
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

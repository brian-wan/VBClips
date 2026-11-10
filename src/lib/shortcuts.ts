/** A key renders as a `<kbd>` chip; `{ text }` is plain text between keys. */
export type ShortcutPart = string | { text: string }

const text = (value: string) => ({ text: value })

export const SHORTCUTS: readonly { keys: readonly ShortcutPart[]; action: string }[] = [
  { keys: ['Space'], action: 'Mark start / mark end' },
  { keys: ['K', text('or click video')], action: 'Play / pause' },
  { keys: [text('Double-click clip row')], action: 'Play that clip only' },
  { keys: ['←', text('/'), '→'], action: 'Seek −5 s / +5 s' },
  { keys: ['↑', text('/'), '↓', text('or'), '[', text('/'), ']'], action: 'Previous / next clip' },
  { keys: ['S'], action: 'Cycle sticky speed 1× / 1.5× / 2×' },
  { keys: ['E'], action: 'Edit selected clip' },
  { keys: ['Delete', text('/'), 'Backspace'], action: 'Delete selected clip' },
  { keys: ['Cmd/Ctrl+Z', text(','), 'Shift+Cmd/Ctrl+Z'], action: 'Undo / redo' },
  { keys: ['Esc'], action: 'Cancel open marker, close dialog, else deselect clip' },
  { keys: ['?'], action: 'Show shortcuts' },
]

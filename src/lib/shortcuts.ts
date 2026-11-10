export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Mark start / mark end' },
  { keys: 'K or click video', action: 'Play / pause' },
  { keys: 'Double-click clip row', action: 'Play that clip only' },
  { keys: '← / →', action: 'Seek −5 s / +5 s' },
  { keys: '↑ / ↓ or [ / ]', action: 'Previous / next clip' },
  { keys: 'S', action: 'Cycle sticky speed 1× / 1.5× / 2×' },
  { keys: 'E', action: 'Edit selected clip' },
  { keys: 'Delete / Backspace', action: 'Delete selected clip' },
  { keys: 'Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z', action: 'Undo / redo' },
  { keys: 'Esc', action: 'Cancel open marker, close dialog, else deselect clip' },
  { keys: '?', action: 'Show shortcuts' },
]

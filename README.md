# VBClipper Web

Browser version of the VBClipper iOS app. Load a volleyball recording, mark where each point
starts and ends, and keep the marked clips. Everything runs in the browser; the video is never
uploaded or read into memory. See [SPEC.md](SPEC.md) for the full product spec.

Phase 1 (this code) is the editor. Joining clips into one video is phase 2; the Join button is
shown but disabled.

## Setup

Requires Node and pnpm.

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (usually http://localhost:5173).

| Script        | What it does                             |
| ------------- | ---------------------------------------- |
| `pnpm dev`    | Start the dev server                     |
| `pnpm build`  | Type-check and build to `dist/`          |
| `pnpm test`   | Run the Vitest unit tests for `src/lib/` |
| `pnpm lint`   | Run ESLint                               |
| `pnpm format` | Format with Prettier                     |

## Using it

1. Choose Video (or drop a video file on the page). MP4 (H.264) and WebM play in all modern
   browsers.
2. Press Space when a point starts and again when it ends. Each pair saves a clip.
3. Open the Clips panel to review, edit, or export the markers as JSON.

The session saves to `localStorage` as you go. Browsers cannot reopen a file on their own, so
Continue Session asks you to pick the same video file again.

## Keyboard shortcuts

| Key                                  | Action                                                     |
| ------------------------------------ | ---------------------------------------------------------- |
| Space                                | Mark start / mark end                                      |
| K or click video                     | Play / pause                                               |
| ← / →                                | Seek −5 s / +5 s                                           |
| Shift+← / Shift+→                    | Seek −1 s / +1 s                                           |
| J / L                                | Seek −10 s / +10 s                                         |
| , / .                                | Step one frame back / forward while paused (assume 30 fps) |
| ↑ / ↓ or [ / ]                       | Previous / next clip                                       |
| S                                    | Cycle sticky speed 1× / 1.5× / 2×                          |
| Hold pointer on right third of video | 2× while held                                              |
| E                                    | Edit selected clip                                         |
| Delete / Backspace                   | Delete selected clip                                       |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z         | Undo / redo                                                |
| Esc                                  | Cancel open marker, close sheet                            |
| ?                                    | Show shortcuts                                             |

Shortcuts are ignored while focus is in a text input.

## Layout

- `src/lib/`: pure clip math, navigation rules, the session reducer, persistence. Unit tested.
- `src/hooks/`: video player, keyboard shortcuts, persistence, toasts, routing.
- `src/screens/`: Home and Editor screens; `src/components/`: shared UI.

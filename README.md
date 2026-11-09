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
3. Review and fix clips in the sidebar, then use Export JSON in the top bar to download the
   markers.

The session saves to `localStorage` as you go. Browsers cannot reopen a file on their own, so
Continue Session asks you to pick the same video file again.

## The editor

The editor is a desktop layout built for mouse and keyboard; it fills the window and never
scrolls (only the clip list does). The minimum supported width is 1024px; below that the clips
sidebar becomes an overlay behind a toggle in the top bar.

- Top bar: Home (saves and goes back), the file name and duration, Export JSON, and Join (phase 2,
  disabled for now).
- Video: click to play or pause. A badge in the top-left shows the speed when it is above 1×.
- Scrubber: hover for the time, click to seek, drag the playhead to scrub. Click a clip segment to
  select it; the selected clip shows two handles you drag to trim its start or end, and the video
  follows the handle so you can see the frame.
- Transport bar: play/pause, back and forward 10 s, previous / current / next clip, the mark
  button (Space), the 1× / 1.5× / 2× speed control, Add clip (a 2 s clip at the playhead), and
  the shortcuts list. Hover any button to see its key.
- Clips sidebar: click a row to select it and jump to its start, double-click to play just that
  clip, hover for the delete icon. An amber dot marks clips that overlap another. The selected
  clip's editor is pinned at the bottom with ±1 s and ±0.1 s nudges, Set to playhead, Preview and
  Delete clip.

## Keyboard shortcuts

| Key                          | Action                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| Space                        | Mark start / mark end                                      |
| K or click video             | Play / pause                                               |
| Double-click clip row        | Play that clip only                                        |
| ← / →                        | Seek −5 s / +5 s                                           |
| Shift+← / Shift+→            | Seek −1 s / +1 s                                           |
| J / L                        | Seek −10 s / +10 s                                         |
| , / .                        | Step one frame back / forward while paused (assume 30 fps) |
| ↑ / ↓ or [ / ]               | Previous / next clip                                       |
| S                            | Cycle sticky speed 1× / 1.5× / 2×                          |
| E                            | Edit selected clip                                         |
| Delete / Backspace           | Delete selected clip                                       |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo / redo                                                |
| Esc                          | Cancel open marker, close dialog, else deselect clip       |
| ?                            | Show shortcuts                                             |

Shortcuts are ignored while focus is in a text input.

![The editor at 1440×900](docs/editor-desktop.png)

## Layout

- `src/lib/`: pure clip math, navigation rules, scrubber hit-testing and trim math, the session
  reducer, persistence. Unit tested.
- `src/hooks/`: video player, keyboard shortcuts, persistence, toasts, routing.
- `src/screens/`: Home and Editor screens, with the editor's scrubber, transport bar, clip list
  and clip editor in `src/screens/editor/`; `src/components/`: shared UI.

# VBClipper Web

Browser version of the VBClipper iOS app. Load a volleyball recording, mark where each point
starts and ends, and keep the marked clips. Everything runs in the browser; the video is never
uploaded or read into memory. See [SPEC.md](SPEC.md) for the full product spec.

The editor (phase 1) marks the clips; Join (phase 2) renders them into one mp4 in the browser with
ffmpeg.wasm.

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
3. Review and fix clips in the sidebar, then use Join in the top bar to render one video, or
   Export JSON to download the markers.

The session saves to `localStorage` as you go. Browsers cannot reopen a file on their own, so
Continue Session asks you to pick the same video file again.

## The editor

The editor is a desktop layout built for mouse and keyboard; it fills the window and never
scrolls (only the clip list does). The minimum supported width is 1024px; below that the clips
sidebar becomes an overlay behind a toggle in the top bar.

- Top bar: Home (saves and goes back), the file name and duration, Export JSON, and Join (see
  Joining clips below; disabled until there is a clip).
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

## Joining clips

Join renders the marked clips back to back into `<video name>-highlights.mp4`, which downloads
automatically (Save again downloads it once more until you close the dialog). Overlapping clips
are merged first, so shared footage appears once. Everything runs in the browser with ffmpeg.wasm;
the source file is mounted read-only, never uploaded or copied into memory.

- Fast (default) stream-copies each clip and then concatenates them. It takes seconds, but cuts
  can only land on keyframes, so a clip may start up to one keyframe interval early (usually
  under a second on phone recordings).
- Precise re-encodes each clip with H.264/AAC, so cuts are frame-accurate. It is much slower in
  the browser; the dialog shows an estimate that updates once the first clip has been measured.

If Fast cannot combine the clips (usually because their codec settings differ), the join switches
to Precise on its own and says why. The joined file is assembled in browser memory, so Join refuses
selections whose output would exceed about 1.5 GB.

### Hosting

ffmpeg's multi-thread core needs `SharedArrayBuffer`, which browsers only allow on cross-origin
isolated pages. `pnpm dev` and `pnpm preview` already send the two headers; a static host serving
`dist/` must send them on every response too:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them the app falls back to the single-thread core, which works everywhere but is slower,
especially in Precise mode. The core's `.js`, `.wasm` and worker files are bundled as separate
assets in `dist/assets/`, so the app never loads them from a CDN and works offline.

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
  reducer, persistence, and the join plan and runner in `src/lib/join/`. Unit tested.
- `src/join/ffmpeg.ts`: the `@ffmpeg/ffmpeg` adapter the join runner uses in the browser.
- `src/hooks/`: video player, keyboard shortcuts, persistence, toasts, routing.
- `src/screens/`: Home and Editor screens, with the editor's scrubber, transport bar, clip list
  clip editor and Join dialog in `src/screens/editor/`; `src/components/`: shared UI.

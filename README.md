# VBClipper Web

Browser version of the VBClipper iOS app. Load one or more volleyball recordings, mark where each
point starts and ends, and keep the marked clips. Everything runs in the browser; the videos are
never uploaded or read into memory. See [SPEC.md](SPEC.md) for the full product spec.

The editor (phase 1) marks the clips; Join (phase 2) renders them into one mp4 in the browser with
ffmpeg.wasm; the timeline (phase 3) shows a filmstrip and lets one session span several videos.

## Setup

Requires Node and pnpm.

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (usually http://localhost:5173).

| Script              | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`          | Start the dev server                                                            |
| `pnpm build`        | Type-check and build to `dist/`                                                 |
| `pnpm preview`      | Serve `dist/`; the service worker only runs here, never under `pnpm dev`        |
| `pnpm test`         | Run the Vitest unit tests in `src/lib/`, `src/join/` and `src/playable.test.ts` |
| `pnpm typecheck`    | Type-check without building                                                     |
| `pnpm lint`         | Run ESLint with type-aware rules; any warning fails                             |
| `pnpm format`       | Format with Prettier                                                            |
| `pnpm format:check` | Check formatting without writing                                                |
| `pnpm icons`        | Render the app icons in `public/icons/` from the volleyball mark (needs Chrome) |

## Using it

1. Choose Video (or drop a video file on the page). MP4 (H.264) and WebM play in all modern
   browsers. MOV plays in Chrome and Safari.
2. To add more recordings of the same match (a second camera, the next set), click the plus tile
   at the right end of the timeline or drop the files anywhere on the editor. They play back to
   back in timeline order; drag a video's name to reorder.
3. Press Space when a point starts and again when it ends. Each pair saves a clip. A clip stays
   inside one video: ending it in a different video shows "A clip can't span two videos".
4. Review and fix clips in the sidebar, then use Join in the top bar to render one video.

The session saves to `localStorage` as you go. Browsers cannot reopen a file on their own, so
Continue Session asks you to pick the same video files again (several at once is fine). If some
are still missing, the card lists them: pick them, or Open without them to drop those videos and
their clips. Sessions saved by earlier versions open as a single-video session.

## The editor

The editor is a desktop layout built for mouse and keyboard; it fills the window and never
scrolls (only the clip list does). The minimum supported width is 1024px; below that the clips
sidebar becomes an overlay behind a toggle in the top bar. It is styled like a desktop editing
tool: 13px type, 32px square-cornered controls, dense 36px clip rows, and tooltips that show
each control's key as a chip.

- Top bar: Home (saves and goes back), the file name and duration (or "3 videos · 1:52:10" with
  several), and Join (see Joining clips below; disabled until there is a clip).
- Video: click to play or pause. A badge in the top-left shows the speed when it is above 1×.
  At the end of one video playback continues with the next.
- Timeline: one block per video, sized by its share of the total length, each with a filmstrip
  of preview frames that fills in as they are read. Hover for the time, click to seek, drag the
  playhead to scrub. Click a clip band to select it; the selected clip shows two handles you drag
  to trim its start or end, and the video follows the handle so you can see the frame. Drag a
  block's header to reorder the videos (Esc cancels); hover a header for its × to remove that
  video and its clips (Undo brings them back). The plus tile adds videos; one that is already in
  the timeline is skipped.
- Transport bar: play/pause, back and forward 5 s, previous / current / next clip, the mark
  button (Space), the 1× / 1.5× / 2× speed control, and the shortcuts list. Hover any button to
  see its key.
- Clips sidebar: click a row to select it and jump to its start, double-click to play just that
  clip, hover for the delete icon. Clips are listed in timeline order, then by start time. An
  amber dot marks clips that overlap another clip of the same video. The selected clip's editor is
  pinned at the bottom with a trim strip, Preview and Delete clip.
- Trim strip: a zoomed filmstrip of the clip with a few seconds either side. Drag the orange
  handles to move the start or end (about 20 ms per pixel, the fine adjustment); the start and end
  times under the handles update as you drag, and releasing is one undo step. Esc during a drag
  puts the clip back. Click anywhere else on the strip to seek there.

## Joining clips

Join renders the marked clips back to back, in timeline order, into
`<first video name>-highlights.mp4`, which downloads automatically (Save again downloads it once
more until you close the dialog). Overlapping clips of the same video are merged first, so shared
footage appears once. Everything runs in the browser with ffmpeg.wasm; each source file is mounted
read-only, never uploaded or copied into memory.

- Fast (default) stream-copies each clip and then concatenates them. It takes seconds, but cuts
  can only land on keyframes, so a clip may start up to one keyframe interval early (usually
  under a second on phone recordings).
- Precise re-encodes each clip with H.264/AAC, so cuts are frame-accurate, and keeps each
  frame's original timing (a variable-frame-rate screen recording is not padded to 120 fps). It
  is much slower in the browser; the mode card shows an estimate at the speed this browser
  managed last time.

Before a join reads a video, it copies it once into the browser's private storage (the Origin
Private File System), shown as "Preparing video · 1.2 of 4.0 GB". Chrome on macOS takes about a
second for every read of a file picked from your own folders, and ffmpeg reads its input in many
small pieces, so reading the picked file directly made a join of two short clips take minutes. The
copy is made with one streaming read in a worker and reads back in a fraction of a millisecond.
Later joins in the same editor session reuse it; leaving the editor (Home, Back or the error
screen) deletes it, and the app deletes any leftovers when it starts. The copy needs free space
for the videos plus 10%. Without that space, or in a browser that cannot write private files from a
worker (older Safari), Join reads the picked file directly and the dialog says it may be slow.

While a join runs, one bar covers the whole job: downloading ffmpeg (about 32 MB with the bytes shown, only
for the first join on this device, since the service worker keeps it), preparing the video, cutting each clip,
combining them and saving. Each part takes its share of the bar by how long it is expected to take, so the percent tracks real work
and never moves backwards (except once, if Fast has to switch to Precise). The time left comes
from the speed measured during the run, smoothed so it does not flicker, and reads "Estimating…"
for the first few seconds. The measured speeds (download, preparing, Fast, Precise and combining) are kept
in `localStorage` under `vbclipper:join-rates`, so the next join starts from them.

Opening videos shows progress too: Choose Video and Continue Session read "Opening <name>…" (or
"Opening 2 of 3…") while each file's length is read, the plus tile spins while added videos are
read, and a block header shows "Preparing frames 12/25" with a thin line until its filmstrip is
complete.

If Fast cannot combine the clips (usually because their codec settings differ, as with videos
from different cameras), the join switches to Precise on its own and says why. The joined file is assembled in browser memory, so Join refuses
selections whose output would exceed about 1.5 GB.

## Keyboard shortcuts

| Key                          | Action                                               |
| ---------------------------- | ---------------------------------------------------- |
| Space                        | Mark start / mark end                                |
| K or click video             | Play / pause                                         |
| Double-click clip row        | Play that clip only                                  |
| ← / →                        | Seek −5 s / +5 s                                     |
| ↑ / ↓ or [ / ]               | Previous / next clip                                 |
| S                            | Cycle sticky speed 1× / 1.5× / 2×                    |
| E                            | Edit selected clip                                   |
| Delete / Backspace           | Delete selected clip                                 |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo / redo                                          |
| Esc                          | Cancel open marker, close dialog, else deselect clip |
| ?                            | Show shortcuts                                       |

Shortcuts are ignored while focus is in a text input.

![The editor at 1440×900](docs/editor-desktop.png)

## Layout

- `src/lib/`: pure clip math, sequence time across sources, navigation rules, timeline
  hit-testing and trim math, the trim strip window, filmstrip tile layout, the session reducer,
  persistence, and the join plan and runner in `src/lib/join/`. Unit tested.
- `src/media/`: reading a file's duration, the editor's files and object URLs, and the in-memory
  thumbnail cache that both filmstrips draw from.
- `src/join/ffmpeg.ts`: the `@ffmpeg/ffmpeg` adapter the join runner uses in the browser.
- `src/join/staging.ts`, `stage.worker.ts` and `stageCopy.ts`: copying the sources into the
  private file system before a join, and deleting the copies.
- `src/hooks/`: the video player that plays the sources back to back, keyboard shortcuts,
  persistence, toasts, the "A new version is ready" prompt, pointer drags, element width.
- `src/screens/`: Home and Editor screens, with the editor's timeline, transport bar, clip list,
  clip editor and Join dialog in `src/screens/editor/`; `src/components/`: shared UI (buttons,
  tooltips and key chips in `ui.module.css`, the `Tip` tooltip, dialogs, toasts). Design tokens
  (type scale, radii, control heights, colors) live in `src/index.css`.
- `scripts/render-icons.ts`: renders the app icons in `public/icons/` from the volleyball mark.

## Deploy

The app is a static site with no backend, accounts or analytics: `pnpm build` writes everything
to `dist/`. Every visitor runs their own copy in their own browser, and their videos, clips and
sessions never leave it.

To publish it on Netlify:

1. Push the repo to GitHub.
2. In Netlify, choose "Add new site", import an existing project, and pick that repository.
3. Deploy. `netlify.toml` does the rest: the build command (`pnpm build`), the publish folder
   (`dist`), the headers below, and the rewrite that serves `index.html` for every path, so a
   reload of `/edit` still opens the app (on Home, since the browser cannot reopen the videos by
   itself).

Any static host that can set the two headers below and an SPA rewrite would also work.

Serve it over https (Netlify does by default; localhost is fine for development): cross-origin
isolation and `crypto.randomUUID` both need a secure context, so plain http on a LAN address gets
neither.

ffmpeg's multi-thread core needs `SharedArrayBuffer`, which browsers only allow on cross-origin
isolated pages. `pnpm dev`, `pnpm preview` and `netlify.toml` all send the two headers that
isolate the page:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

On a host that cannot set headers the app still works: it falls back to the single-thread core,
which is slower, especially in Precise mode. Since `require-corp` blocks every cross-origin
resource that does not send a `Cross-Origin-Resource-Policy` header, any asset added later from
another origin (a font, an image CDN) must send one or be served from the app itself. The core's
`.js`, `.wasm` and worker files are bundled as separate assets in `dist/assets/`, so the app never
loads them from a CDN.

A visitor's first join downloads one ffmpeg core, about 32 MB. The browser caches it (everything
in `/assets/` is served with a one-year `immutable` Cache-Control, since every file name there is
hashed) and so does the service worker, so later joins and later visits skip the download. The
rest of the app is under 300 KB, so the core is nearly all the bandwidth a visitor costs: a free
tier with 100 GB a month covers about 3,000 first-time visitors, and returning visitors cost
almost nothing.

## Install as an app

In Chrome or Edge, the install icon at the right end of the address bar installs VBClipper as an
app with its own window and icon. It works offline after first use: the service worker keeps the
app from the first visit and the ffmpeg core from the first join. When a new version is deployed,
a toast says "A new version is ready" with a Reload button. Nothing reloads until you press it,
so an update never interrupts a join.

## License

VBClipper Web is free software, licensed under the GNU General Public License, version 3 or (at
your option) any later version (`GPL-3.0-or-later`). The full text is in [LICENSE](LICENSE).

Join runs the cores from [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)
(`@ffmpeg/core` and `@ffmpeg/core-mt`), which are builds of [FFmpeg](https://ffmpeg.org) that
include the [x264](https://www.videolan.org/developers/x264.html) H.264 encoder used by Precise
mode. Because of x264 those cores are licensed GPL-2.0-or-later, and since the app ships them in
`dist/`, the app is published under the GPL too. FFmpeg and x264 remain under their own
copyrights and licenses.

# VBClipper Web: product and design spec

Web rebuild of the VBClipper iOS app. You load a volleyball recording, scrub through it,
mark where each point starts and ends, and later join the marked clips into one shorter
video with the dead time removed. Everything runs in the browser; there is no backend.

This spec is settled. Build what it says; do not reopen stack, layout or interaction
decisions. If something here is impossible, say so in the report instead of improvising.

## Stack

- Vite + React 18 + TypeScript, pnpm. Plain CSS modules (no Tailwind, no UI kit).
- Video playback through a single HTML5 `<video>` fed an object URL from the picked `File`.
  Never read the file into memory.
- State: one reducer for the session (video fingerprint, clips, selection, marking state).
  Pure functions for all clip math live in `src/lib/` and are unit tested with Vitest.
- Persistence: `localStorage`, keyed by a video fingerprint (`name|size|lastModified`).
- ESLint + Prettier from the Vite template. No other dependencies in phase 1.

## Phases

1. Editor (this phase): home, choose video, mark clips, clip list, navigation, edit, delete,
   undo, session persistence, keyboard shortcuts, JSON export of markers.
2. Join: render the clips into one downloadable mp4 in the browser with ffmpeg.wasm.
   Details in "Phase 2: Join" below.
3. Timeline: filmstrip preview, several source videos in one session, drag to reorder.
   Details in "Phase 3: Timeline" below.
4. Desktop look: denser, squarer controls so the editor reads as a desktop tool, not a phone
   app. Details in "Phase 4: Desktop look" below.
5. Accurate progress for opening videos and for Join. Details in "Phase 5: Progress" below.
6. Hardening, cleanup and stuck-path fixes from the two audits. Details in "Phase 6: Hardening"
   below.
7. Hosting prep: host config, license, installable app, README deploy section. Details in
   "Phase 7: Hosting prep" below.
8. Fast file access for Join: stage the source in the browser's private file system, and keep
   variable frame rate in Precise. Details in "Phase 8: Join speed" below.
9. Phones and tablets: a single-column touch layout. Details in "Phase 9: Mobile" below.
10. Seamless cuts: no frame holds at join points, verified on a 25-minute recording. Details in
    "Phase 10: Seamless cuts" below.

## Screens

### Home (`/`)

Matches the iOS home: centered orange volleyball icon, "VBClipper" title,
"Select a volleyball video to start clipping points" subtitle, a large orange
"Choose Video" pill button. Below it, if a saved session exists, a dark card
"Continue Session" with "N clips · m:ss clipped", a chevron, and a red trash icon that
clears the saved session (confirm with a small inline "Delete?" state, not `window.confirm`).
A blue "How it works" link opens a modal listing the shortcuts (see Shortcuts).

Choose Video opens a file picker (`accept="video/*"`). Drag and drop onto the page also works.
If the browser cannot play the file (the video element fires `error`),
show a clear message naming the file and suggesting mp4/H.264, mov or webm. Do not pre-reject
on `canPlayType`: Chrome answers empty for `video/quicktime` yet plays H.264 mov files.

Continue Session: the browser cannot reopen a file by itself, so the card asks the user to
pick the same file again. If the picked file's fingerprint does not match, show
"That doesn't look like the same video (expected name, size)" with options
"Use it anyway" (keeps clips) or "Pick another".

### Editor (`/edit`)

This is a desktop web app, not a phone app in a browser. Everything is driven by mouse and
keyboard; there are no touch gestures, no slide-up sheets, no bottom-of-screen thumb controls.
Use the whole viewport. Minimum supported width is 1024px; below that, the sidebar collapses to
a toggle but nothing else changes.

Layout is a fixed-height grid filling the viewport (no page scroll):

```
+-------------------------------------------------------------------------------+
| Top bar: [‹ Home]  video-name.mp4 · 1:23:45                   [Join 12 Clips] |
+---------------------------------------------------------+---------------------+
|                                                         | Clips (12)          |
|   Video, letterboxed, fills the remaining height        | ------------------- |
|   (max-height = viewport − top bar − scrubber −         | Clip 1   0:12 → 0:19|
|    transport bar − gutters)                             | Clip 2   0:41 → 0:52|
|                                                         | ...                 |
|                                                         |                     |
+---------------------------------------------------------+ Selected clip       |
| Scrubber (full width of the video column)               | editor (fixed at    |
+---------------------------------------------------------+ the sidebar bottom) |
| Transport bar                                           |                     |
+---------------------------------------------------------+---------------------+
```

- Grid: `minmax(0, 1fr) 360px`, 24px gutters, 16px gaps between rows. Background `#000`;
  the sidebar is a `#1C1C1E` panel with a 1px `#38383A` left border.
- Top bar (56px): "‹ Home" text button on the left saves and returns home. Center: the file name
  in white and the total duration in secondary grey. Right: the orange "Join N Clips (m:ss)" pill, which opens the Join dialog (disabled when there are no clips).
- Video: a `<video>` inside a black frame, `object-fit: contain`. Clicking anywhere on the
  video toggles play/pause. A play glyph fades in over the center for 400 ms on each toggle, as on
  YouTube. No hold gesture.
- Scrubber: 12px tall track, 24px hit area. Grey base, orange segments for saved clips, lighter
  orange live segment while marking, white playhead with a 2px stem. Hover shows a time tooltip
  above the pointer. Click to seek; drag the playhead to scrub (pause while dragging, resume if it
  was playing). Clicking a clip segment selects that clip without seeking. The selected clip's
  segment shows two 8px drag handles at its ends; dragging a handle trims start or end with the
  same validation as the clip editor, and the video seeks to the handle time while dragging so the
  frame is visible. Below the track: current time (left), total duration (right).
- Transport bar (64px), three groups separated by space, every button with a tooltip naming its
  key:
  - Left: Play/Pause (44px round), then "−5s" and "+5s" icon buttons (the only seek step), then "‹ Clip N ›" as
    three separate buttons (prev, label, next; the label opens the clip in the editor).
  - Center: the mark button (56px round, green ring idle, orange with a stop square while
    marking) with the caption "Space" under it in secondary grey.
  - Right: a segmented speed control with three segments "1×", "1.5×", "2×"; the active segment
    is filled orange. Next to it a "?" button that opens the shortcuts modal. (An earlier "Add
    clip" button that inserted a 2 s clip at the playhead was removed as not useful.)
- Clips sidebar: header "Clips (N)" with total clipped duration right-aligned. The list fills the
  remaining height and scrolls on its own. Each row (48px): "Clip N" in orange, "m:ss.t → m:ss.t"
  in grey, duration right-aligned, an amber dot when the clip overlaps another. The selected row
  has a `#2C2C2E` background. Single click selects and seeks to the clip start; double click starts
  playback of that clip only. Rows have a small trash icon on hover (delete with Undo toast).
  Empty state: "No clips yet. Press Space to mark the start of a point."
- Selected clip editor: pinned to the bottom of the sidebar, shown whenever a clip is selected,
  with the same fields as before: Start and End rows each with −1 s / −0.1 s / +0.1 s / +1 s nudges (phase 3 replaces these rows with a trim strip, see "Clip editor trimmer")
  and "Set to playhead", a Preview button, a red Delete button, and the clip length. Rules are
  unchanged: start ≥ 0, end ≤ duration, end − start ≥ 0.2 s; disabled nudges, never silent clamps.
- Toasts appear bottom-center over the video column.
- The shortcuts modal is a centered dialog, closed by Esc, clicking outside, or its Done button.

Spacing rules: nothing touches. Minimum 12px between any two controls, 24px between groups, 16px
padding inside the sidebar. Use the layout's own whitespace rather than borders to separate groups.
## Marking model

- The mark button is green with a hollow ring when idle. Pressing it (or Space) records the
  playhead as the open start marker. If the video is paused, marking a start also
  starts playback. The button turns orange with a square stop glyph and the
  scrubber draws the live segment. Pressing again records the end and saves the clip.
- If the end would be less than 0.2 s after the start (user seeked backwards), show a toast
  "Clip end must come after its start" and stay in the marking state.
- Escape cancels the open marker.
- Clips may overlap in the editor; the join step merges overlaps. Show a small amber dot on
  overlapping rows in the Clips panel.
- Undo (Cmd/Ctrl+Z) reverts the last clip change: add, delete, edit. Redo with Shift+Cmd/Ctrl+Z.
  Keep a bounded history (50).
- Deleting a clip from the sidebar editor, a row's trash icon, or Delete/Backspace shows a 5 s toast with Undo.

## Playback

- Speed: the segmented control in the transport bar sets 1×, 1.5× or 2×; `S` cycles through the
  same three values. The speed persists across seeks and clip navigation until changed.
  A "2× speed" badge with a fast-forward icon shows in the top-left corner of the video frame
  while the speed is above 1×.
- Seeking: one step only, 5 s back or forward (arrow keys, or the two transport buttons). No
  1 s, 10 s or frame-step seeks: the trim nudges in the clip editor cover fine adjustment.
  Seeks clamp to [0, duration] and all go through one `seek(t)` helper.
- Prev/next clip seeks to the target clip's start, selects it, and keeps the current play state.
  "Next" from after the last clip wraps to the first; "Prev" within the first 1 s of a clip goes
  to the previous clip, otherwise to the current clip's start (music-player rule).
- Clicking the video toggles play/pause.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Mark start / mark end |
| K or click video | Play / pause |
| Double-click clip row | Play that clip only |
| ← / → | Seek −5 s / +5 s |
| ↑ / ↓ or [ / ] | Previous / next clip |
| S | Cycle sticky speed 1× / 1.5× / 2× |
| E | Edit selected clip |
| Delete / Backspace | Delete selected clip |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo / redo |
| Esc | Cancel open marker, close dialog, else deselect clip |
| ? | Show shortcuts |

Shortcuts are ignored while focus is in a text input. Space must not scroll the page or
trigger a focused button; call `preventDefault` and keep focus off the control buttons after
clicks (blur them) so Space always means "mark".

## Design principles

These apply on top of the tokens below. They are the difference between a tool that looks
considered and one that looks generated.

- Information design over decoration. The editor is scanned and operated, not read. State is
  encoded in form, not only in color or text: the mark button changes shape (ring vs stop square),
  the selected clip row changes background, an overlap gets a dot, the active speed segment is
  filled. Every interactive element looks interactive, with a visible hover and focus state
  (2px `#FF9F0A` outline offset 2px for keyboard focus, never `outline: none` without a replacement).
- Hierarchy through type and space, not borders. One accent (orange) carries all primary actions
  and clip markers; semantic colors (green mark, red delete, amber overlap) are separate from the
  accent and never used for emphasis. Separate groups with whitespace first; use a 1px separator
  only where whitespace alone fails (the sidebar edge, list rows).
- Numbers line up. All times, durations and counts use `font-variant-numeric: tabular-nums` so
  the scrubber readout and clip rows do not jitter as values change.
- Repeated elements are identical. Clip rows share the same height, padding, baselines and the
  same position for every element; nudge buttons in the editor share one width.
- Spacing comes from layout. Use flex/grid with `gap`, never per-element margins between siblings.
  Sizes come from a 4px grid: 4, 8, 12, 16, 24, 32.
- Motion is functional. 150 ms ease-out for state changes, 400 ms fade for the play glyph overlay,
  nothing bouncy, and everything behind `prefers-reduced-motion: reduce` collapses to instant.
- Copy is part of the design. Buttons say what happens ("Mark start", "Delete clip"), toasts say
  what happened ("Clip 3 deleted"), errors say what to do next. Short, active, no apologies.
- Avoid the generic. No gradient heroes, no emoji in UI, no card chrome on every block, no
  identical rounded corners everywhere. The video and the scrubber are the hero; chrome stays quiet.

## Visual design tokens

Dark iOS look, copied from the app screenshots.

- Background `#000000`; card surface `#1C1C1E`; raised surface `#2C2C2E`; separators `#38383A`.
- Text `#FFFFFF`; secondary text `#8E8E93`.
- Accent orange `#FF9F0A` (buttons, clip segments, clip titles); pressed state 85% opacity.
- Mark green `#30D158` with a soft outer glow; marking state uses the accent orange.
- Link blue `#0A84FF`; destructive red `#FF453A`; overlap amber `#FFD60A`.
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif`.
  Title 34px bold on home; control labels 17px semibold; captions 15px.
- Pills: fully rounded (999px), 48px tall for primary actions. Icon buttons are 44px circles on
  `#1C1C1E`. Dialogs and the sidebar editor card have 16px radius. Tooltips are `#2C2C2E` with 13px text.
- Motion: 150 ms ease-out for state changes; no bouncy animations.

## Time formatting

- `formatTime(seconds)`: `m:ss` under an hour, `h:mm:ss` otherwise. Clip rows and the editor
  show one decimal (`m:ss.t`). Durations under 10 s in the join button still use `m:ss`.

## Persistence format

```ts
type SavedSession = {
  version: 1;
  video: { name: string; size: number; lastModified: number; duration: number };
  clips: { id: string; start: number; end: number }[];
  playhead: number;
  savedAt: number;
};
```

Save (debounced 300 ms) after every clip change and on back. Only one session is kept in
phase 1.

## Phase 2: Join

Joining turns the marked clips into one mp4 the user downloads. It runs entirely in the browser
with ffmpeg.wasm; no upload, no server.

### Settled decisions

- Library: `@ffmpeg/ffmpeg` 0.12.x with `@ffmpeg/core-mt` when `crossOriginIsolated` is true and
  `@ffmpeg/core` (single thread) otherwise. Core `.js`/`.wasm`/`.worker.js` files are served from
  the app itself (import with Vite `?url`), never from a CDN, so the app works offline and is not
  at the mercy of a third-party host.
- The multi-thread core can hang on load in some Chromium builds even when the page is isolated
  (seen in the Claude desktop browser: the single-thread core loads in 0.1 s, the multi-thread core
  never resolves). Loading the multi-thread core therefore races a 8 s timeout; on timeout the
  adapter terminates it, loads the single-thread core, remembers that choice for the rest of the
  page's life, and emits a log line "Multi-thread core did not start; using the single-thread
  core" that the dialog shows under the progress bar. A join must never wait forever on
  "Loading ffmpeg" while a loaded core restarts; while the core files download, the label shows
  the real byte count (Phase 5), which replaced the old "First load downloads about 30 MB" hint.
- `vite.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on both `server` and `preview` so the
  multi-threaded core can use `SharedArrayBuffer` in dev. Document in the README that static hosts
  need the same two headers (and that the single-thread fallback works without them).
- The source file is never copied into wasm memory. Mount it with WORKERFS
  (`ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, '/in')`) and read it as `/in/<name>`.
  Game recordings are multi-gigabyte; `writeFile` of the whole source would crash the tab.
- Segments to render are `mergeOverlaps(clips)` in start order, so overlapping clips are
  included once. The output is the segments back to back with no transitions, titles or audio
  changes.
- Two modes, chosen in the Join dialog, default Fast:
  - Fast: stream copy. Per segment `-ss <start> -to <end> -i /in/<name> -c copy
    -avoid_negative_ts make_zero -movflags +faststart seg<i>.mp4`, then the concat demuxer with
    `-c copy`. Cuts land on the keyframe at or before each start, so a clip may begin up to a
    keyframe interval early (about one second on phone recordings). Takes seconds. Say this in the
    dialog in plain words: "Fast: exact to the nearest keyframe, usually within a second."
  - Precise: re-encode. Per segment `-ss <start> -to <end> -i /in/<name> -c:v libx264
    -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart seg<i>.mp4`,
    then concat with `-c copy`. Frame-accurate but slow in wasm; show the estimated time as
    "about N minutes" computed from a measured encode rate after the first segment (before that,
    assume 0.15× realtime).
  - If a Fast concat fails (mixed codec parameters across segments is the usual cause), fall back
    to Precise automatically and tell the user why.
- Output name: `<video name without extension>-highlights.mp4`. Delivered as a Blob download
  (`<a download>` click) and also kept in memory with a "Save again" button until the dialog
  closes; revoke the object URL on close.
- Cancel calls `ffmpeg.terminate()` and reloads the core on the next join. Closing the dialog
  while a join runs asks "Stop joining?" inline (no `window.confirm`).
- Memory ceiling: the output is assembled in MEMFS, so refuse to start when the estimated output
  exceeds 1.5 GB (segment duration × source bitrate, from `file.size / duration`) and explain
  that the selection must be shorter. For Fast mode the segment files are deleted from MEMFS as
  soon as they are listed in the concat file; for Precise they are deleted after concat.

### Join dialog

Opened by the top-bar Join button. Centered dialog, 520px wide, same chrome as the shortcuts
modal.

1. Summary row: "N clips · m:ss total · about X MB" (size estimate from source bitrate).
2. Mode: two radio cards, Fast (default) and Precise, each with a one-line explanation as above.
3. Primary button "Join N clips". Secondary "Cancel".
4. While running: the progress bar described in "Phase 5: Progress" (one bar over download,
   cutting, combining and saving, with a phase label, true percent, elapsed and remaining time)
   and a "Stop" button. All editor shortcuts are inert while the dialog is open (the Dialog component already
   does this).
5. When done: "Saved <name>" with the final size, buttons "Save again" and "Done". The download
   starts automatically once.
6. On error: the ffmpeg log tail (last 20 lines) in a monospace block with a "Copy log" button, and
   a "Try Precise" button when the failure was in Fast mode.

### Code layout

- `src/lib/join/plan.ts`: pure functions. `planSegments(clips)`, `segmentArgs(mode, seg, i, input)`,
  `concatListContent(n)`, `concatArgs(output)`, `outputFileName(videoName)`,
  `estimateOutputBytes(segments, fileSize, duration)`, `estimateSeconds(mode, segments, rate)`.
  Vitest covers each. (Overall progress moved to `src/lib/join/progress.ts` in Phase 5.)
- `src/lib/join/runner.ts`: the orchestrator. Takes an `FFmpegLike` interface (load, mount,
  exec, readFile, deleteFile, writeFile, on, terminate) so the unit test uses a fake that records
  calls and emits progress; the real adapter in `src/join/ffmpeg.ts` wraps `@ffmpeg/ffmpeg`.
  Emits `{ phase, segmentIndex, progress, log }` events and resolves to a `Blob`.
- `src/screens/editor/JoinDialog.tsx` and its CSS module. The Join button in the top bar opens it.

### Verification

- `pnpm test`, `pnpm lint`, `pnpm build` pass; the build must not inline the wasm (check that the
  core files appear as separate assets in `dist/`).
- In the browser: with the 30 s test video (`ffmpeg testsrc`, H.264), mark three clips, join in
  Fast mode, download, and check with `ffprobe` that the result has one video stream, duration
  equal to the merged segments within one keyframe interval, and plays in the browser. Repeat in
  Precise mode and check the duration is within 0.1 s. Join a selection with two overlapping clips
  and confirm the overlap appears once. Stop a Precise join mid-way and start another.

## Testing

- Vitest unit tests for `src/lib/`: clip insertion and sorting, overlap detection and merging,
  prev/next clip selection rules, nudge validation, time formatting, fingerprint matching,
  undo/redo reducer transitions.
- No end-to-end tests in phase 1. Verify the editor by hand in the browser with a real video.

## Done means

- `pnpm install && pnpm dev` serves the app; `pnpm test`, `pnpm lint`, `pnpm build` pass.
- In the browser at 1440×900 and 1024×768: load a video, mark three clips with Space, navigate
  them with the transport buttons and arrow keys, trim one by dragging a scrubber handle, edit one
  in the sidebar editor, delete one and undo it, change speed with the segmented control, reload
  the page, continue the session by picking the same file, and see the same clips. No page scroll
  at either size.
- `README.md` documents setup and the shortcut table.

## Phase 3: Timeline

Settled. The scrubber becomes a CapCut-style timeline: every loaded video sits in a row as a
block with a filmstrip of preview frames, a plus tile at the right end adds more videos, and
dragging a block reorders the videos. Where this section conflicts with "Screens", "Marking
model", "Persistence format" or "Phase 2: Join" above, this section wins.

### Model

- A session holds an ordered list of **sources**. A source is one picked video:
  `{ id, name, size, lastModified, duration }` with `id = fingerprint(name|size|lastModified)`.
  At runtime each source also has its `File` and one object URL, created when the source is
  added and revoked when it is removed or the editor unmounts. Never read a file into memory.
- The **sequence** is the sources played back to back in list order. Sequence time `T` runs
  from 0 to the sum of durations; `offsetOf(i)` is the sum of the durations before source `i`.
  Pure helpers in `src/lib/sequence.ts`: `offsetOf`, `totalDuration`, `locate(T) -> { index,
  localTime }`, `toSequence(index, localTime)`, `moveSource(sources, from, to)`. Unit tested.
- A **clip** is `{ id, sourceId, start, end }` with start and end in that source's local time.
  A clip never spans two sources. Clip order everywhere (list, prev/next, join) is source order,
  then start time.
- The reducer's history snapshots now hold `{ sources, clips }`, so undo and redo also revert
  adding, removing and reordering sources. New actions: `addSource`, `removeSource` (also drops
  its clips), `moveSource(from, to)`. Keep `HISTORY_LIMIT` at 50.

### Timeline (replaces the scrubber)

- Lives where the scrubber was, full width of the video column. Rows from top: block headers
  (20px), filmstrip (48px), times (current sequence time left, total right). Fit to width: the
  sequence always spans the full strip width minus the plus tile; no zoom in this phase.
- Each source is a **block** whose width is its share of the total duration. Block header: file
  name (ellipsized) and duration in secondary grey, a small × on hover that removes the source
  (5 s Undo toast, same as deleting a clip). Blocks are separated by a 2px `#000` gap.
- The header is the **drag handle** for reordering: cursor `grab`, pointer-capture drag, the block
  follows the pointer as a translucent ghost, a 2px orange insertion line shows the drop slot
  between blocks, drop dispatches `moveSource`. Escape cancels the drag. Below 3px of travel it is
  a click and does nothing. The filmstrip keeps the existing scrubber interactions unchanged: click
  to seek, drag the playhead, click a clip segment to select, drag the selected clip's handles to
  trim (`src/lib/scrubber.ts` hit-test math stays, now evaluated inside the block under the pointer
  with local time).
- **Filmstrip**: a row of frames covering the block, one per `tileWidth = 64px` at the strip's
  48px height (`object-fit: cover`, so 16:9 sources are cropped a little at the sides), taken at evenly spaced local times. Frames come from a hidden `<video>` per
  source (`preload="metadata"`, muted) seeking in order and drawing to a canvas; store them as
  data URLs or `ImageBitmap`s in an in-memory cache keyed by `sourceId` and rounded time, never
  in `localStorage`. Tiles show a `#2C2C2E` placeholder until their frame arrives, so a long
  recording fills in progressively. Recompute the tile set when the strip width changes by more
  than one tile (debounced 200 ms); cached frames are reused.
- Clip segments draw over the filmstrip as orange bands at 45% opacity with 2px solid top and
  bottom edges; the selected clip is 65% with white 8px trim handles as before; the live marking
  band is the lighter orange. Overlap dot rule unchanged. White playhead with a 2px stem spans
  the filmstrip and header rows.
- **Plus tile**: a 48×48 tile at the right end of the strip row, raised surface with a plus icon
  and the tooltip "Add video". Click opens the file picker (`accept="video/*"`, multiple). Each
  picked file that is not already a source (by fingerprint) is appended in picked order; duplicates
  show a toast "Already in the timeline". Dropping video files anywhere on the editor does the same.
  An unplayable file shows the existing message and is not added.

### Clip editor trimmer (replaces the nudge buttons)

The pinned clip editor keeps its header ("Clip 6" in orange, "Length 0:02.0" right-aligned) and
its Preview and Delete clip buttons. The Start and End rows with the −1 s / −0.1 s / +0.1 s / +1 s
nudges and the "Set to playhead" links are removed. In their place sits a **trim strip**, like the
trimmer in iOS Photos or CapCut, zoomed in on the clip:

- A filmstrip 56px tall spanning the card width, showing a window of the clip's source around
  the clip: `[start − pad, end + pad]` with `pad = max(2 s, clip length / 2)`, clamped to the
  source's `[0, duration]`. Frames come from the same thumbnail cache as the timeline, one per
  48px tile, at evenly spaced times inside the window (`#2C2C2E` placeholders until they arrive).
- The window is computed when the selected clip changes and stays fixed while a handle is being
  dragged, so the frames never move under the pointer. After a drop, if either edge is within 10%
  of the window's edge, recompute the window from the new clip.
- The strip outside the clip is dimmed with a 60% black overlay. The clip region has a 2px orange
  frame (top and bottom edges) and an 8px orange handle at each edge with a short white grip line,
  cursor `ew-resize`. A thin white playhead line shows when the playhead is inside the window.
- Dragging a handle moves that edge in local time at the window's scale (a 6 s window over a
  300px card moves about 20 ms per pixel, which is the fine adjustment). Validation is `trimClip`
  (start ≥ 0, end ≤ duration, length ≥ 0.2 s). The main video seeks to the handle time during the
  drag so the frame is visible; releasing dispatches one `updateClip` (one undo step). Escape
  during a drag restores the clip.
- Under the strip: the start time under the left handle and the end time under the right handle
  in `m:ss.t`, live during a drag. Clicking the strip away from a handle seeks the main video to
  that time. Dragging the body of the selection does nothing in this phase.
- Pure helpers in `src/lib/trimmer.ts` (`trimWindow`, `timeAtX` for the window, `shouldRecenter`),
  unit tested.

### Playback across sources

- One `<video>` element. When the playhead reaches the end of a source and a next source exists,
  swap `src` to the next source's object URL, seek 0 and keep playing (a brief black frame is
  acceptable). After the last source, pause at the end. Seeks to a sequence time in another
  source swap `src` and seek to the local time. Speed persists across the swap. A seek that
  originates inside a source (a trim handle, a click or drag inside a block) stays in that source
  even at its exact end: the player exposes `seekLocal(index, localTime)` for those, and only
  sequence-time seeks (arrows, transport buttons, prev/next clip) go through `locate`.
- Arrow keys and the transport buttons seek 5 s in sequence time, crossing boundaries.
- Marking: Space marks in the current source. Pressing Space to end a clip while a different
  source is current shows the toast "A clip can't span two videos" and keeps the marker open;
  Escape cancels it. When playback auto-advances into the next source while a marker is open,
  show the same toast at that moment and keep the marker open.
- Top bar center: one source shows name and duration as before; several show "3 videos · 1:52:10".

### Home and persistence

- `SavedSession` becomes `version: 2` with `sources: SourceMeta[]` (ordered) and clips carrying
  `sourceId`. Version 1 saves are read and upgraded in memory to one source. The storage key is the
  fingerprint of the first source; saving still removes other keys.
- Continue Session opens a multi-select picker. Picked files match sources by fingerprint. If any
  source is still missing, the card lists them ("Still needed: court2.mov") with "Pick files" and
  "Open without them", which drops the missing sources and their clips. "Open without them" appears only
  once at least one file matched, since a session with no videos has nothing to open. The mismatch flow for a
  single-source save ("Use it anyway" / "Pick another") stays.

### Join

- `Segment` gains `sourceIndex`. Each source is mounted at `/in<i>` with WORKERFS; segments are
  rendered in sequence order and concatenated as before. Output name comes from the first source.
  The Fast-to-Precise fallback already covers sources whose codec settings differ; say so in the
  dialog's Fast description: "If videos differ, Join switches to Precise automatically."
- Estimates sum over all segments; `mergeOverlaps` runs per source.

### Verification

- Unit tests for `sequence.ts`, the new reducer actions with undo/redo, `moveSource`, version 1
  to 2 upgrade, join planning with two sources. Run the whole suite, lint, typecheck and build.
- Browser: load two short test videos (make them with ffmpeg `testsrc`, different sizes so Fast
  concat fails), confirm the filmstrip fills in, reorder by dragging the header, mark a clip in
  each, cross a boundary during playback, reload and Continue Session with both files. Do not
  run a Join in the browser pane: a finished join downloads a file and the download prompt
  interrupts the user. Verify join planning through the unit tests instead.

## Phase 4: Desktop look

Settled. The editor currently borrows iOS proportions (17px labels, 48px pills, 44px round icon
buttons, 16 to 24px card radii) and reads as a phone app stretched wide. This phase makes every
component read as a desktop editing tool, in the spirit of CapCut desktop or Final Cut: smaller
type, square-cornered controls, denser rows, visible hover states. Colors and the dark palette
stay exactly as they are; the layout grid, the timeline, the trim strip, all interactions and all
shortcuts stay as they are. Only sizes, shapes, type and spacing change. Where this section
conflicts with sizes given earlier in "Screens", this section wins.

### Tokens (replace in `src/index.css`)

| Token | Value | Notes |
| --- | --- | --- |
| `--font-family` | `Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif` | No web font download; the app stays offline-capable |
| `--font-title` | 24px | Home title only |
| `--font-heading` | 15px / 600 | Panel titles ("Clips (12)", "Clip 6", dialog titles) |
| `--font-body` | 13px | Every control label and row text |
| `--font-caption` | 12px | Secondary text, times under the timeline, block headers |
| `--font-micro` | 11px | Key chips, the speed badge |
| `--radius-control` | 6px | Every button, input, segment and chip |
| `--radius-panel` | 8px | Cards, dialogs, toasts, the Continue card |
| `--control-height` | 32px | Default button and icon-button size |
| `--control-height-small` | 28px | Segments, clip editor actions, row actions |
| `--color-hover` | #3a3a3c | Kept; every button gets it on hover |

Remove `--radius-pill`, `--height-pill`, `--size-icon-button`, `--radius-sheet`, `--radius-card`,
`--font-label` and every use of them. The only round elements left are the mark button, the
overlap dot and the playhead head. All times use `font-variant-numeric: tabular-nums`.

### Shared controls (`src/components/ui.module.css`)

- `button` (was `pill`): 32px tall, 0 12px padding, 6px radius, 13px/500, surface background,
  hover `--color-hover`, pressed opacity. `primary`: accent background, black text. `secondary`:
  surface background. `destructive`: transparent background, `--color-destructive` text, hover
  tints the background `rgba(255, 69, 58, 0.15)`. No filled red buttons anywhere.
- `iconButton`: 32×32, 6px radius (not a circle), 18px glyphs, same hover.
- Tooltips: 12px, 6px radius, shown after 300 ms, and they name the key as a chip: a `<kbd>`
  element at 11px with a 1px separator border and 4px radius, e.g. "Play  K". Tooltips are a small
  `Tip` component rather than CSS on a data attribute, since a chip needs an element. Secondary
  buttons that sit on a surface-colored panel use `--secondary-background`, one shade lighter, so
  they stay visible.
- `linkButton`: 13px.

### Screens

- **Top bar**: 44px. "‹ Home" is a 13px secondary icon-and-text button. Center: file name 13px
  white, duration 12px secondary. Right: Join as a `primary` 32px button.
- **Transport bar**: 58px (a 40px mark button plus its 16px key chip and a 2px gap; 48px was
  too short for that stack). Play 36×36 square (6px radius) with a 20px glyph; the 5 s buttons and
  "?" are 32px icon buttons; the clip navigation is one 32px group with 1px `--color-separator`
  dividers between prev, label and next, 6px radius on the group. The mark button stays round but
  shrinks to 40px with a 28px ring, and its "Space" caption becomes an 11px `<kbd>` chip under it.
  The speed control is a 28px segmented group with 6px radius, 4px inner padding, segments 2px
  radius, 12px text; the active segment is filled accent with black text. Groups keep 16px gaps.
- **Clips sidebar**: 320px wide. Header 15px/600 title, 12px total. Rows 36px with 12px padding,
  13px name in accent, 12px tabular range in secondary, 12px duration right-aligned; 1px separator
  between rows; hover `--color-surface-raised`; the selected row has `--color-surface-raised` plus a
  2px accent bar on its left edge instead of a rounded fill. The trash icon is a 28px icon button
  shown on hover. Empty state 13px secondary.
- **Clip editor**: no longer a card. It is a panel section with a 1px `--color-separator` top
  border and 12px padding. Title row: 15px/600 "Clip 6" in accent, 12px "Length 0:05.0" right. The
  trim strip stays 56px with the same frame and handles. Actions row: `secondary` 28px "Preview"
  and `destructive` 28px "Delete clip" (text style, right-aligned).
- **Timeline**: no shape changes. Block header text 12px, times row 12px tabular, the plus tile is
  48×48 with a 6px radius, the "Add video" tooltip gains no key chip.
- **Home**: still centered, max width 400px. Title 24px/700, subtitle 13px secondary. "Choose
  Video" is a `primary` 36px button, full width. The Continue card is 8px radius with a 1px
  separator border, 13px title, 12px subtitle, the trash a 32px icon button; the "Delete?" confirm
  a 28px destructive text button. Hint and "How it works" 12px.
- **Dialogs** (Join, shortcuts): 8px radius, 1px separator border, 15px/600 title, 13px body,
  32px buttons, 20px padding. Shortcut rows show keys as `<kbd>` chips.
- **Toasts**: 8px radius, 13px, 32px tall action button.
- **Speed badge**: 11px, 6px radius, 22px tall.

### Verification

- `docs/editor-desktop.png` regenerated at 1440×900 (2x) with one video and three clips, one
  selected. No page scroll at 1024×768 or 1440×900; every control still has its tooltip; keyboard
  focus rings visible; the mark, speed and clip navigation still work by mouse and key.
- Whole test suite, lint, typecheck, Prettier and build pass. No new dependencies.

## Phase 5: Progress

Settled. Two places show progress and both must be honest: the number on screen is the share of
the real work that is done, it never sits at one value while work continues, and the time left
comes from measured speed, not a guess. Where this conflicts with "Join dialog" above, this wins.

### Join progress model (`src/lib/join/progress.ts`, pure, unit tested)

- The job is a list of **phases**, each with an amount of work and a rate that converts work into
  expected seconds. The bar shows `expectedSecondsDone / expectedSecondsTotal`, so a phase's
  share of the bar is its share of the expected time, not an equal slice.
  - `download`: bytes of the core files still to fetch (0 when the core is already loaded in this
    page). Work is bytes; rate is bytes per second, measured live from the first chunk, with an
    assumed 5 MB/s until 1 s of data exists.
  - `cut`: one entry per segment, work is the segment's duration in seconds, rate is output
    seconds per wall second for the mode (`fast` or `precise`). Progress inside a segment comes
    from ffmpeg's `progress` event `time` as today (`segmentRatio`).
  - `concat`: work is the total output duration, rate is the `concat` rate. ffmpeg's `progress`
    events during the concat exec drive it (`time / totalDuration`); today they are ignored.
  - `save`: reading the output file and making the Blob, work is the estimated output bytes at a
    fixed 200 MB/s. Small, but it keeps the bar moving at the end instead of stalling at 99%.
- **Rates are learned.** Defaults: fast 20, precise 0.15, concat 40 (output seconds per second),
  download 5 MB/s. During a run the model measures each phase's real rate (work done over wall
  time, ignoring the first 2 s of a phase) and, when the phase finishes, stores it in
  `localStorage` under `vbclipper:join-rates` as `{ version: 1, fast, precise, concat, download }`.
  The next join starts from the stored rates. The warm-up and the measurement run per rate key, not per
  segment: all Fast cuts in a run form one measurement, so a run whose cuts total under 3 s learns
  nothing and keeps the stored rate. The download rate is measured from the first chunk to the last
  chunk only; core start time never counts toward it. The estimate shown on the Precise mode card before
  starting uses the stored rate too.
- **Remaining time** is the remaining expected seconds at the current measured rates, smoothed
  with an exponential moving average (factor 0.3 per update) so it does not flicker. Shown as
  "about 4 min left", "about 1 min left" or "under a minute left"; before 3 s of measurements the
  label is "Estimating…". Elapsed time stays.
- **Percent** is `Math.floor(fraction * 100)`, rises monotonically within a run (a later lower
  value is clamped to the last shown), and reads 100% only when the Blob exists. The only reset is
  the Fast-to-Precise fallback: the bar restarts at the end of the download share with the label
  "Switched to Precise: re-encoding" and the Precise rates. During those cuts the label reads
  "Switched to Precise: re-encoding clip 3 of 12" so the clip count stays visible.
- **Phase label** above the bar: "Downloading ffmpeg · 12.3 of 31.5 MB", "Starting ffmpeg" (from the
  last byte until the core answers, including the multi-thread timeout wait), "Cutting clip 3 of 12",
  "Combining clips", "Saving", then "Saved <name>". When the download total is unknown (no
  Content-Length), show bytes received and treat the download work as 31 MB.

### Core download with progress (`src/join/ffmpeg.ts`)

- Fetch each core file (`core.js`, `core.wasm`, and the worker for the multi-thread core) with
  `fetch` and a `ReadableStream` reader, reporting `{ received, total }` per chunk, then hand
  `ffmpeg.load` blob URLs for all of them (as `@ffmpeg/util`'s `toBlobURL` does). Blob URLs are
  cached for the page so a second join skips the phase. The 8 s multi-thread timeout and the
  single-thread fallback stay exactly as specified in Phase 2; a fallback does not re-download
  files it already has. The 8 s timeout covers starting the multi-thread core only, not the
  download before it, so a slow network never forces the single-thread core.
- `FFmpegLike.load` gains an optional `onProgress({ received, total })` callback so the runner can
  feed the model; the test fake records it. `load` also takes the join's `AbortSignal`: Stop during the
  download aborts the fetches, and the runner checks the signal right after `load` resolves and
  throws `JoinCancelled` before mounting anything, so a cancelled join never completes in the
  background. A runner test covers abort during the download.

### Runner events (`src/lib/join/runner.ts`)

- `JoinEvent` carries `phase: 'download' | 'start' | 'cut' | 'concat' | 'save' | 'fallback' | 'done'`,
  `progress` (the model's overall fraction), `segmentIndex`, `remainingSeconds | null`,
  `label` (the phase label text) and `log`. The dialog renders events; it computes nothing itself.
  Events are coalesced to at most one per animation frame, so a download of thousands of chunks
  does not mean thousands of renders. The dialog reads the stored Precise rate once when it opens.
- Progress events during concat are forwarded (today `onProgress` returns early outside the
  segment phase).

### Opening videos

- **Home**: from the moment a file is picked until the editor opens, the Choose Video button (or
  the Continue card) is disabled and reads "Opening saturday-game.mp4…" with a 2px indeterminate
  bar under it (the duration probe is one metadata read with nothing to measure). Picking several
  files for Continue Session reads "Opening 2 of 3…" and the bar is determinate, files done over
  files total. Every Home control that opens or picks files ("Pick files", "Open without them",
  "Use it anyway", "Pick another") is disabled while a probe is running.
- **Editor plus tile**: while an added file is being probed the tile shows a spinner glyph and is
  disabled; the "Opening…" text and the "2 of 3" count live in its tooltip and aria-label, since
  the 48px tile has no room for text.
- **Preview frames**: `ThumbnailStore` exposes `progress(sourceId): { done, total }` and notifies
  subscribers as frames land. While a block's frames are incomplete its header shows
  "Preparing frames 12/25" in caption colour after the duration, and a 2px accent progress line
  runs along the bottom edge of the header, `done / total` wide. Both disappear when done. The
  trim strip shows the same 2px line along its bottom edge while its own frames are pending.

### Verification

- Unit tests: phase weighting (a 30 MB download at 5 MB/s plus 60 s of Precise at 0.15 gives the
  download about 1.5% of the bar), learned rates round-trip through storage, monotonic percent,
  fallback reset, remaining-time smoothing, label text, download reader with a fake stream that
  has and lacks Content-Length, concat progress forwarded.
- Browser: no Join in the built-in pane (the download prompt interrupts the user). Use headless
  Chrome over CDP with downloads denied (`Browser.setDownloadBehavior` deny), a generated 20 min
  640×360 `testsrc` video (`-preset ultrafast`) and clips totalling about 2 min. Run Precise once
  cold: the download phase must show bytes, the bar must move through every phase without a stall
  longer than 2 s, percent must never go backwards, and the remaining-time label at 25% progress
  must be within 30% of the actual remaining wall time. Run Fast once warm: no download phase,
  remaining time shown. Reload and confirm the Precise card's estimate uses the learned rate.
  Open a video from Home and confirm the "Opening…" state, and watch a block header count frames.

## Phase 6: Hardening

Settled. Two read-only audits (stuck paths; cleanup and hardening) ran against the Phase 5 tree.
Every item below was confirmed in code. No visual or interaction redesign: fixes only, plus the
accessibility items named here. Where this conflicts with earlier sections, this wins.

### Stuck paths

- **ffmpeg never waits forever.** The single-thread core load races a 30 s timeout and fails
  with `JoinError('ffmpeg did not start')`. During `cut`, `concat` and `save`, a watchdog fails
  the join with `JoinError('ffmpeg stopped responding')` and terminates the worker when no `log`
  or `progress` event arrives for 120 s. Each `reader.read()` of the core download races a 30 s
  timer and fails with `JoinError('The download stalled')`. All three land in the existing error
  state (log tail, Copy log, Try Precise where it applies). "Try Precise" is offered only
  for failures inside a Fast cut or concat, never for a download, start or stall failure. Unit tests with fake timers for each.
- **Stop before the core starts.** `signal.throwIfAborted()` runs immediately before every
  `ffmpeg.load(...)`, and the library's `load(config, { signal })` form is used so an abort in the
  gap between the last byte and the LOAD message rejects the load.
- **Back and Forward never lose clips.** A `popstate` that leaves `/edit` is treated exactly like
  the Home button: the editor saves, `input` is cleared, Home shows Continue Session. Forward
  therefore lands on Home, never on a stale editor. Test the App route reducer if one is extracted.
- **Timeline drags always end.** Strip scrubs, trims and header reorders end (cancelled) on
  `lostpointercapture` not caused by our own release, and on window `blur`. Escape during a strip
  trim restores the clip and keeps it selected (stop propagation), matching the trim strip. One
  `usePointerDrag` hook in `src/hooks/` owns capture, release, pointerId matching, Escape,
  `lostpointercapture` and `blur` for the Timeline and the ClipEditor; each caller supplies only
  `onMove`, `onCommit`, `onCancel`.
- **Thumbnail extractor bounds.** `ready` resolves false after 15 s or on `dispose()`; after
  `ready`, an `error` on the hidden video drains both queues through `onMiss`, so a file that
  becomes unreadable costs no more than one timeout.
- **Memory ceiling.** `MAX_OUTPUT_BYTES` stays 1.5 GB as the hard block. From 500 MB up to the block the summary
  adds "Large output: the browser may run out of memory. Precise mode makes a smaller file." The
  watchdog above turns a dead worker into the error "ffmpeg stopped responding, usually because
  the browser ran out of memory. Try fewer clips or Precise mode."
- **Continue Session dead end.** `loadAll` reports the ids that failed to open; they are removed
  from `found` before the error shows, so the user can pick again or open without them.
- **Error boundary.** `src/components/ErrorBoundary.tsx` wraps `<Editor>` in `App.tsx`: on a
  render error it shows "Something went wrong. Your clips are saved." with the error message in a
  collapsed details block and a "Back to Home" button that navigates to `/`.
- **Save order.** `saveSession` writes the new key first, then removes the others.
- **Hidden tab progress.** Event coalescing falls back to a 250 ms timer while `document.hidden`,
  so a join in a background tab still updates when the tab returns.

### Hardening

- `newId()` falls back to a random 128-bit hex string when `crypto.randomUUID` is missing
  (plain-http LAN hosting).
- **Undo toasts undo that change.** Deleting a clip or removing a source remembers the removal's
  own history entry; the toast's Undo dispatches `undo` only if that entry is still the latest
  step (a length check would be fooled once history is at its 50-step cap), otherwise a new
  `restoreClip(clip)` or `restoreSource(source, index, clips)` action re-inserts exactly what was
  removed. Reducer tests for both.
- **Dialog keys.** The Dialog no longer swallows every key at the window. `useEditorShortcuts`
  takes `disabled: boolean`, true while any dialog is open; the Dialog handles Escape on its own
  element. Focus: trap Tab inside the dialog, focus the primary action on open (Join N clips, or
  Done), and return focus to the opener on close.
- **Backdrop close** fires only when both `pointerdown` and `pointerup` land on the backdrop, so
  selecting log text and releasing outside does not close the dialog. A pointerdown on the
  backdrop never moves focus out of the dialog (`preventDefault` on the backdrop's mousedown), so
  Tab and Escape keep working after a press that did not close it.
- **Frame cache eviction.** `ThumbnailStore.retain` drops frames of sources no longer retained,
  and the cache is capped at 2,000 frames, least recently requested evicted first.
- **Playback error mid-session.** A `<video>` error after a source has loaded pauses and shows the
  toast "Playback error in <name>", staying in the editor; only a failure to load the first source
  still exits to Home with the unplayable message.
- Replace the `forEach` narrowing cast in `Timeline.tsx` with a `for...of` loop and the
  `HTMLElement` cast in `useEditorShortcuts` with `instanceof`.

### Cleanup

- Remove: the `@ffmpeg/util` dependency and its `optimizeDeps.exclude` entry; the `addClip`
  reducer action (session tests build fixtures through `load` and `markStart`/`markEnd`);
  `weightedProgress` and its tests; `clipsOverlap`; `sameVideo`; `FRAME_DURATION`;
  `--color-accent-soft`; the stale add-clip comment in `clips.ts`; the `data-testid` attributes;
  the `stage` test-only surface by deriving `JoinEvent.phase` from the model's stage
  (`fallback` stays the one hand-set event).
- Collapse: one `Filmstrip` component in `src/components/` with its own CSS module used by the
  Timeline and the ClipEditor; one `useElementWidth(ref, settle?)` hook replacing `useWidth` and
  `useLaidOutWidth`; one `undoToast(message, undo)` helper; the Editor's duplicated
  seek/prev/next handler triple defined once; `ui.textButton` replacing the Dialog `.done` and
  Toasts `.action` styles; `clamp` from `clips.ts` used in place of inline `Math.min(Math.max())`.
- Exports used only inside their own module lose `export` (the audit's list: scrubber, trimmer,
  plan, runner, progress and ffmpeg constants).

### Build and config

- `tsconfig.app.json`: `strict: true` explicit, `exactOptionalPropertyTypes: true`,
  `noUncheckedIndexedAccess: true`, with every resulting error fixed properly (no `!`
  assertions to silence them).
- ESLint: `tseslint.configs.recommendedTypeChecked` with `parserOptions.projectService: true`,
  so floating and misused promises are errors. Fix what it finds.
- `package.json`: scripts `typecheck` (`tsc -b`), `format:check` (`prettier --check .`),
  `lint` with `--max-warnings 0`; `packageManager` pinned to the installed pnpm and `engines.node`
  to the installed major.
- README: hosting must be https (cross-origin isolation and `crypto.randomUUID` need a secure
  context); COEP `require-corp` blocks any future cross-origin asset without a CORP header; the
  tests sentence names `src/join` and `src/playable.test.ts` too.

### Tests

- New: `parseSavedSession` negatives (garbage JSON, missing fields, non-finite numbers, unknown
  version, wrong `sourceId` type); `keptPlayhead` moved to `lib/sequence.ts` and tested;
  `matchSavedSources(session, found, files)` extracted from Home to `lib/` and tested
  (mismatch only for a one-source save with no match, auto-open when every source is found, "Open
  without them" only once something matched); `dispatchKey` and `isTextInput` exported from a
  `lib/keys.ts` and tested (key to handler, Space ignores repeat, Cmd+Z vs Shift+Cmd+Z, ignored in
  text inputs); `SourceFiles.retain` revokes only dropped ids; the JoinDialog event filter
  extracted as a pure function and tested.
- Replace the eight-event exact table in `runner.test.ts` with one weighting assertion (the
  concat share) and keep the monotonicity test.

### Accessibility

- **Keyboard trim.** The trim strip (`role="group"`) is focusable (`tabIndex 0`). While it has
  focus, ← / → move the start edge by 0.1 s and Shift+← / Shift+→ move the end edge, through the
  same `trimClip` validation and `updateClip`; its tooltip names these keys. Each press also seeks
  the video to the moved edge, as dragging does. Clicking the strip does not focus it (clicks never
  leave focus on a control), so the strip is reached by Tab. No other new keys.
- **Clips list**: drop the `listbox`/`option` roles; each row is a `<button>` (Enter selects,
  double-click previews as today) with the trash as a sibling button, so rows are reachable by Tab.
- **Timeline strip**: remove `role="slider"` and mark the strip `aria-hidden`; the keyboard seek
  and clip navigation remain the accessible path. No keyboard reorder in this phase.
- **Live regions**: the Join done block gets `role="status"`; a visually hidden status span
  announces phase changes only (never the per-frame byte label).
- **Speed control**: roving tabindex (one tab stop, arrows move), per the ARIA radio pattern.
- **Contrast**: new token `--color-text-secondary-raised: #a1a1a6` for secondary text on
  `--color-surface-raised` (mode descriptions, kbd chips in tooltips, disabled plus glyph, row
  trash icon).

### Verification

- Whole suite, `lint`, `typecheck`, `format:check`, build. Both cores still separate assets.
- Browser (pane for keys and DOM, headless Chrome for anything needing a real pointer or a Join
  with downloads denied): Back then Forward from the editor shows Home with Continue Session and
  the clip count intact; a strip trim cancelled by Escape keeps the clip selected and unchanged;
  Stop pressed during "Starting ffmpeg" returns to idle; an unhandled render error (temporarily
  thrown from a component in a scratch branch, not committed) shows the boundary screen; Tab from
  the Join dialog's last control wraps to its first; the keyboard trim moves an edge by 0.1 s.

## Phase 7: Hosting prep

Settled. The app is a static site; every visitor already has a private copy because nothing
leaves the browser. This phase makes the repo deployable to a public URL in one step and
installable as an app. It adds no backend, no accounts and no analytics.

### Host configuration

- `netlify.toml` at the repo root: build `pnpm build`, publish `dist`; headers for `/*`:
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`,
  `X-Content-Type-Options: nosniff`; for `/assets/*`: `Cache-Control: public, max-age=31536000,
  immutable` (every asset name is hashed); a redirect `/* -> /index.html 200` so `/edit` reloads.
- Netlify is the one target. No `vercel.json` or other host files; the README mentions in one
  sentence that any static host able to set the two headers and an SPA rewrite would also work.
- `index.html` gains `<meta name="description">`, `<meta name="theme-color" content="#000000">`
  and the manifest link. `public/robots.txt` allows everything.
- A direct load of `/edit` with no video shows Home (already the case); keep it.

### License

- The bundled ffmpeg cores (`@ffmpeg/core`, `@ffmpeg/core-mt`) are GPL-2.0-or-later because
  they include x264. The app is therefore published under **GPL-3.0-or-later**: a `LICENSE` file
  with the full text, `"license": "GPL-3.0-or-later"` in `package.json`, and a README section
  "License" that names FFmpeg and x264 and links to ffmpeg.wasm.

### Installable app

- `vite-plugin-pwa` (the one new dependency) with `registerType: 'prompt'`. Never auto-reload:
  when a new version is waiting, show the existing toast "A new version is ready" with a "Reload"
  action; the user decides, so an update never interrupts a join.
- Manifest: name "VBClipper", short name "VBClipper", `display: standalone`, background and theme
  `#000000`, start URL `/`, icons 192 and 512 px PNG rendered from the volleyball mark in
  `src/components/Icons.tsx` (plus a maskable 512), generated once with a script under `scripts/`
  and committed under `public/icons/`.
- Precache: the app shell (`index.html`, the JS and CSS bundles, icons, favicon). Do not precache
  the ffmpeg cores; cache them at runtime with a CacheFirst rule for `/assets/ffmpeg-core*` (one
  year, both `.js` and `.wasm` and the worker) so a core is fetched once and the app works offline
  after the first join. Cached responses keep their original headers, so the service worker stays
  compatible with cross-origin isolation.
- The dev server does not register the service worker (`devOptions.enabled: false`).

### Home

- Under the subtitle, one caption line: "Your videos never leave this computer." Nothing else
  changes on Home.

### README

- A "Deploy" section for Netlify: push the repo to GitHub, "Add new site" from that repo, and
  `netlify.toml` does the rest (build command, publish folder, headers, rewrite); https is required; the two headers and why; what happens on a host that cannot set
  headers (single-thread core, slower Precise); the 32 MB first-visit download and that it is
  cached by the browser and the service worker; bandwidth math for free tiers (about 3,000
  first-time visitors per 100 GB).
- An "Install as an app" paragraph (Chrome and Edge address-bar install, offline after first use)
  and the "License" section above.

### Verification

- `pnpm build` produces `dist/manifest.webmanifest`, `dist/sw.js`, the icons, and still both
  cores as separate assets; `pnpm preview` in headless Chrome registers the service worker, the
  manifest is valid (Chrome's `getInstalledRelatedApps` is not needed; check
  `navigator.serviceWorker.ready` and the manifest fetch), a reload of `/edit` under preview still
  lands on Home, and after one Join the core request is served from the cache on the second join
  (observe via `performance.getEntriesByType('resource')` transfer sizes). Validate `netlify.toml`
  by reading it against Netlify's documented schema; no account is created.
- Whole suite, lint, typecheck, format check pass.

## Phase 8: Join speed

Settled, from measurements on the user's own file (a 63 s, 2392×1842, variable-frame-rate macOS
screen recording in `~/Downloads`) and on a generated 1080p file.

### The problem

- Joining two 3 s clips in Fast mode took 157 s in the browser; the same two ffmpeg commands take
  0.2 s natively and 30 ms in ffmpeg.wasm when the input is already in memory.
- The cause is not ffmpeg. In Chrome on macOS, every read of a byte range of a `File` picked from
  the user's own folders (`~/Downloads`, `~/Desktop`, `~/Movies` all measured) costs about one
  second, whatever the size (4 KB, 32 KB, 8 MB all about 1 s), on the main thread and with
  `FileReaderSync` in a worker alike. The same file copied under `/private/tmp` reads in 1 ms.
  Reading the whole file in one request is fast (25 MB in 137 ms). ffmpeg.wasm's WORKERFS mount
  reads the input in many small slices, so a stream copy of a few hundred packets takes minutes.
- Precise mode re-encodes variable-frame-rate input to a constant 120 fps (ffmpeg 5.1's default
  for mp4 output), encoding 695 frames where the source had 261. That doubles the work and makes a
  120 fps 2392×1842 file that players struggle to decode, which reads as stutter or slow motion.

### Staging the source

- Before mounting, Join copies each source once into the Origin Private File System with a single
  streaming read in a worker (`file.stream()` → `FileSystemSyncAccessHandle.write`), then mounts
  the staged `File` (`handle.getFile()`) in WORKERFS. Measured: 25 MB in 41 ms, 243 MB in 297 ms
  (820 MB/s); slices of the staged file read in 0.2 ms.
- Staged copies live under an OPFS directory `vbclipper-stage/`, named by a 16-digit hash of the
  source fingerprint plus the original extension (the raw fingerprint contains `|`, unusable in an
  ffmpeg path), and are reused by later joins in the same editor session. They are deleted when the editor exits
  (Home button, Back, error boundary exit) and any leftovers are deleted on app start.
- Before staging, check `navigator.storage.estimate()`: if `quota - usage` is under the total
  source size plus 10%, or OPFS or `createSyncAccessHandle` is unavailable (older Safari), skip
  staging and mount the original `File` as today, and add one line to the dialog summary:
  "This browser cannot cache the video, so joining may be slow." The quota rule counts only
  copies still to be written, so a second join of a large file is never refused. A copy that fails
  part way (disk full) falls back to the original `File` the same way.
- Progress: a new `stage` phase ("Preparing video · 1.2 of 4.0 GB") before `cut`, work in bytes,
  rate learned like the others (default 500 MB/s, stored key `stage`). Cancel aborts the stream
  and removes the partial staged file.
- Pure parts (`src/lib/join/stage.ts`: directory and file naming, quota rule, progress math) are
  unit tested; the worker code has a test with a fake stream and access handle.
- Known limits, accepted: a second tab starting the app deletes the staged copies of an editor open
  in another tab (a join running there would then fail its reads and the next join copies again);
  joining while the filmstrip is still extracting frames can slow staging by a few seconds because
  both read the same file. The staged rate is timed from the first chunk with no warm-up, so most
  copies are too short to learn from and the default stays.

### Precise keeps the source timing

- Precise segment arguments gain `-fps_mode passthrough` (ffmpeg 5.1 supports it) and
  `-avoid_negative_ts make_zero`, so frames are neither duplicated nor dropped and each segment's
  container duration matches its last frame. Measured on the screen recording: 261 frames instead
  of 695, cuts 4.3 s instead of 8.7 s, output 660 KB instead of 781 KB, timing identical to the
  source. Constant-frame-rate phone video is unaffected.
- The concat step is unchanged. A test asserts the new arguments; the browser check compares the
  join's video packet timestamps with the source's over the clip range (no duplicates, no gaps the
  source does not have).

### Verification

- Unit tests as above, whole suite, lint, typecheck, format, build.
- Headless Chrome against `pnpm preview` with the user's `~/Downloads/reflow_override.mov`
  (read-only; copy nothing into the repo): Fast join of two 3 s clips must finish in under 5 s
  including staging (was 157 s), Precise in under 15 s (was 114 s); the staged file is present in
  OPFS during the editor session and gone after Home; a second join reuses it (no `stage` phase);
  with OPFS blocked (override `navigator.storage.getDirectory` to throw), the join still completes
  through the direct mount and the summary shows the one-line note.

## Phase 9: Mobile

Settled. The desktop layout stays exactly as it is at 1024px and up. Below that the app becomes
a touch tool. Two inputs drive the rules: viewport width (`max-width: 699px` is a phone,
700 to 1023px a tablet) and pointer type (`(pointer: coarse)` is touch). Nothing about the data,
the join or the shortcuts changes; keyboard shortcuts keep working when a keyboard is attached.

### Phone layout (under 700px wide)

- One column, no page scroll, height `100dvh`, safe-area insets applied: the top bar adds
  `env(safe-area-inset-top)`, the bottom-most panel adds `env(safe-area-inset-bottom)`, and both
  sides keep `max(12px, env(safe-area-inset-left/right))` gutters.
- Rows from the top: top bar 44px (Home, file name and duration, Join as an icon-and-text button
  that shrinks to its icon under 360px); the video at full width in a 16:9 frame capped at 38% of
  the viewport height (letterboxed, `object-fit: contain`); the timeline (header 20px, filmstrip
  56px, times row); the transport bar 56px; then the clips panel filling the remaining height.
  The clips panel is always visible: no sidebar toggle and no overlay on phones. Its list scrolls
  inside the panel; the clip editor with the trim strip stays pinned at the panel's bottom when a
  clip is selected, as on desktop.
- Landscape phones (height under 500px): the video cap drops to 30% and the clips panel may get
  as little as 120px; it still scrolls. Known limit, accepted: a phone that is both under
  700px wide and under 500px tall (older small phones in landscape) cannot honor both the video
  cap and the 120px panel minimum; the panel minimum wins and the video may collapse. Modern phones
  are over 700px wide in landscape and get the tablet layout.
- The mark button is 56px round in the transport bar's center; its caption reads "Mark" on
  touch instead of "Space", which makes the phone transport bar 74px tall (accepted, as in Phase
  4). Ten controls cannot each be 44px wide on a 390px phone, so on phones the transport bar is
  one row of six: Play, Previous clip, the clip label, Next clip, Mark, and a single speed button
  that shows the current speed and cycles 1× → 1.5× → 2× on tap. The two 5 s seek buttons are
  hidden on phones (the filmstrip is the seek control by touch) and so is the "?" shortcuts
  button. Every control is then at least 44px wide down to 340px of viewport width. The top-bar
  Join button keeps its text where it fits.

### Tablet layout (700 to 1023px)

- Today's behavior stays: the desktop grid with the clips sidebar as an overlay behind a top-bar
  toggle. Touch rules below apply when the pointer is coarse.

### Touch rules (`(pointer: coarse)`, any width)

- Every control is at least 44×44 CSS px of hit area (padding or a pseudo-element, the visual
  size may stay smaller). Buttons get `touch-action: manipulation` so double taps do not zoom.
- Trim handles on the timeline and the trim strip draw 12px wide and accept pointers within 22px;
  the scrubber and trimmer hit-test tolerances (`HANDLE_HIT_PX`, `PLAYHEAD_HIT_PX`, the trimmer's
  handle tolerance) are read from a `pointerTolerance()` helper that returns the larger values when
  `matchMedia('(pointer: coarse)')` matches, covered by a unit test on the pure math.
- No hover tooltips and no key chips on touch: the `Tip` component renders nothing when the
  pointer is coarse; `aria-label`s stay so screen readers are unchanged. The trim strip shows a
  one-line caption under it on touch: "Drag the handles to trim" (replaces the key hint).
- Long press on a clip row is not used; a tap selects, a second tap on the selected row plays that
  clip only (the desktop double-click). On touch the row trash shows on the selected row only; the ×
  that removes a video stays visible with its hit area extended upward, away from the filmstrip.
  The playhead grab distance on touch stays 12px (a tap on the bare strip scrubs anyway). The
  plus tile is 48×56 on phones to match the filmstrip. The empty list reads "Tap Mark at the
  start of a point" on touch. `viewport-fit=cover` is set so the safe-area insets take effect. Strip drags, header reorder and the plus tile work by touch
  as they do by mouse (pointer events already handle both); `-webkit-touch-callout: none` and
  `user-select: none` on the strips so a long drag never opens the callout or selects text.
- The Join dialog is full-screen on phones (no backdrop margin) with 44px buttons. On touch
  devices it adds one line to the summary when the estimated output exceeds 200 MB: "On a phone,
  large joins can run out of memory. Fast mode and fewer clips help."

### Home on phones

- Same content, 16px gutters, Choose Video and the Continue card full width, 44px tall controls.

### Verification

- Unit tests: `pointerTolerance()` values; nothing else is pure.
- Headless Chrome with device emulation and touch (`Emulation.setDeviceMetricsOverride`,
  `Emulation.setTouchEmulationEnabled`, `Emulation.setEmitTouchEventsForMouse`) at 390×844
  portrait and 844×390 landscape, plus 768×1024: no horizontal scroll and no page scroll; every
  interactive element's hit box is at least 44×44; open a video, mark two clips with the mark
  button, trim with a touch drag on the trim strip and on the timeline, reorder two videos by a
  touch drag, run a Fast join (downloads denied); screenshots of the editor at 390×844 saved as
  `docs/editor-phone.png` (2x) and shown in the README with one sentence. The desktop screenshot
  and the desktop layout at 1440×900 are unchanged (compare the DOM rects of the top bar,
  transport bar and sidebar before and after).
- A real iPhone or Android check is the user's; list what to look at in the report (safe-area
  fit, the Photos picker, join memory).

## Phase 10: Seamless cuts

Settled, from a stress test on a generated 25-minute 1080p30 recording with audio (ten 12 s clips
spread across it) and an 8-minute 1080p60 one (eight clips), both join modes.

### The problem

- Inside every clip the timing is exact: Precise produced 3600 frames for 120 s at a constant
  33.33 ms, Fast kept the source's intervals, and audio and video stay in sync. No slow motion,
  no duplicated or dropped frames.
- At every join point the video holds for an extra 2 to 3 frames: 60 to 70 ms in Fast, about
  100 ms in Precise (50 ms at 60 fps). Cause: the concat demuxer offsets each segment by the
  segment's container duration, and each segment's AAC audio runs 14 to 39 ms past its video (AAC
  frames are 23 ms and Precise segments also carry encoder priming), so the next segment starts
  late and the last frame is held. Over ten cuts the output ends about half a second after where
  the clips alone would, and a viewer sees a stutter at every cut.
- A single-pass encode through the `concat` filter (several `-ss/-to -i` inputs) fixes this
  natively but hung inside ffmpeg.wasm (idle for ten minutes on four inputs), so it is not used.

### The fix: exact durations in the concat list

- `concatListContent` takes the segments' video durations and writes
  `file 'seg<i>.mp4'` followed by `duration <seconds>` (three decimals) for each entry, so the
  demuxer offsets every segment by its video length, not its container length.
- The duration must come from measurement, not formulas. Two formulas were tried in the wasm core
  (ffmpeg 5.1.4) and both fail: for Fast, the last `progress` time of a null copy pass is the last
  DTS from the container start, not the video length (cut intervals came out 8 to 20 ms instead of
  33); for Precise, `end - start` is not the video length when a clip is not a whole number of
  frames, and the concat demuxer lines each file up by its container start, which includes audio,
  while the video starts 8 to 56 ms later depending on the segment.
- So after each segment is written, the runner runs the core's `ffprobe` (`@ffmpeg/ffmpeg` 0.12.15
  exposes it; 2 to 16 ms per call) on the segment for the container start, the video stream start
  and the video duration, and writes `duration_i = vdur_i + lead_i - lead_(i+1)` where
  `lead = video start - container start` (the last segment uses its own lead). `FFmpegLike` gains
  `ffprobe(args)` and the runner reads the JSON it writes. The probe is part of the `cut` phase and
  emits no label of its own. A probe failure falls back to no `duration` line for that entry (the
  old behavior), never to a failed join; when the next segment's probe failed, the entry uses its
  own lead in place of the next one's. Core 0.12.10's `ffprobe` returns exit code -1 even on
  success, so the runner judges a probe by whether its JSON parses, never by the exit code.
- Measured in the real core with this list: Precise and Fast joins are seamless at 30 and 60 fps
  (one identical frame interval across every cut), and the screen recording still passes through
  at its own timing (261 frames). The
  audio overlaps the next segment by at most one 23 ms AAC frame at each cut; ffmpeg adjusts the
  timestamp by one tick and logs "Non-monotonic DTS", which is expected and not an error. The
  dialog's error path must not treat that log line as a failure.

### Stress script

- `scripts/stress-join.mjs` (developer tool, not CI): generates a 25-minute 1080p30 and an
  8-minute 1080p60 test recording with ffmpeg if absent (under the OS temp directory, never in the
  repo), serves `pnpm preview`, drives headless Chrome over CDP to join ten (or eight) clips in
  both modes, and runs the checks with ffprobe: every video interval equals the frame interval
  within 1 ms (Fast varies by up to 0.07 ms from three-decimal durations), no duplicate timestamps, container and audio durations within 25 ms of
  the video, Precise total equal to the selected total within 5 ms, Fast total equal to the
  selected total plus keyframe leads within 50 ms, and frame content at 4 s into every clip
  matching the source frame: for Fast, SSIM at least 0.98 (a stream copy is pixel identical); for
  Precise, SSIM at least 0.97 and higher than against both neighbouring source frames, which
  proves alignment without grading the encoder (a CRF 20 veryfast re-encode of the generated
  test pattern scores 0.978 to 0.99 against its own exact frame). It prints a table and exits non-zero on any
  failure. README gets one paragraph on running it.

### Verification

- Unit tests for the list content with durations and for the per-segment probe (a fake `ffprobe`
  that writes JSON), including a clip that is not a whole number of frames. Whole suite, lint, typecheck, format, build.
- `scripts/stress-join.mjs` passes on both recordings; report the table. Also re-run the
  screen-recording check from Phase 8 (Precise 261 frames, timing identical to the source) to
  make sure variable frame rate still passes through.

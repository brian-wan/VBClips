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
   Details in "Phase 3: Timeline" below. Polish and mobile layout come after.

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
| Top bar: [‹ Home]  video-name.mp4 · 1:23:45     [Export JSON] [Join 12 Clips] |
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
  in white and the total duration in secondary grey. Right: a secondary "Export JSON" pill and the
  orange "Join N Clips (m:ss)" pill, which opens the Join dialog (disabled when there are no clips).
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
    is filled orange. Next to it an "Add clip" button (plus icon) that inserts a 2 s clip at the
    playhead and selects it, and a "?" button that opens the shortcuts modal.
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
  playhead as the open start marker. The button turns orange with a square stop glyph and the
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
phase 1. "Export JSON" in the top bar downloads this object as `<video name>.clips.json`.

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
  "Loading ffmpeg": after 5 s in that phase the dialog adds "First load downloads about 30 MB".
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
4. While running: a progress bar with the current segment ("Segment 3 of 12"), overall percent
   from ffmpeg's progress events weighted by segment duration, the elapsed time, and a "Stop"
   button. All editor shortcuts are inert while the dialog is open (the Dialog component already
   does this).
5. When done: "Saved <name>" with the final size, buttons "Save again" and "Done". The download
   starts automatically once.
6. On error: the ffmpeg log tail (last 20 lines) in a monospace block with a "Copy log" button, and
   a "Try Precise" button when the failure was in Fast mode.

### Code layout

- `src/lib/join/plan.ts`: pure functions. `planSegments(clips)`, `segmentArgs(mode, seg, i, input)`,
  `concatListContent(n)`, `concatArgs(output)`, `outputFileName(videoName)`,
  `estimateOutputBytes(segments, fileSize, duration)`, `estimateSeconds(mode, segments, rate)`,
  `weightedProgress(segments, index, ratio)`. Vitest covers each.
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
- **Filmstrip**: a row of 16:9 frames (`object-fit: cover`) covering the block, one per
  `tileWidth = 64px`, taken at evenly spaced local times. Frames come from a hidden `<video>` per
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
  source swap `src` and seek to the local time. Speed persists across the swap.
- Arrow keys and the transport buttons seek 5 s in sequence time, crossing boundaries.
- Marking: Space marks in the current source. Pressing Space to end a clip while a different
  source is current shows the toast "A clip can't span two videos" and keeps the marker open;
  Escape cancels it. A marker left open when playback auto-advances follows the same rule.
- Top bar center: one source shows name and duration as before; several show "3 videos · 1:52:10".

### Home and persistence

- `SavedSession` becomes `version: 2` with `sources: SourceMeta[]` (ordered) and clips carrying
  `sourceId`. Version 1 saves are read and upgraded in memory to one source. The storage key is the
  fingerprint of the first source; saving still removes other keys.
- Continue Session opens a multi-select picker. Picked files match sources by fingerprint. If any
  source is still missing, the card lists them ("Still needed: court2.mov") with "Pick files" and
  "Open without them", which drops the missing sources and their clips. The mismatch flow for a
  single-source save ("Use it anyway" / "Pick another") stays.
- Export JSON writes the version 2 shape.

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

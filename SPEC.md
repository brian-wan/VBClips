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
2. Join: render the clips into one downloadable mp4 in the browser with ffmpeg.wasm
   (re-encode each segment for frame-accurate cuts, then concat). Button exists in phase 1
   but is disabled with a "coming soon" tooltip.
3. Multiple source videos in one session, polish, mobile layout.

## Screens

### Home (`/`)

Matches the iOS home: centered orange volleyball icon, "VBClipper" title,
"Select a volleyball video to start clipping points" subtitle, a large orange
"Choose Video" pill button. Below it, if a saved session exists, a dark card
"Continue Session" with "N clips · m:ss clipped", a chevron, and a red trash icon that
clears the saved session (confirm with a small inline "Delete?" state, not `window.confirm`).
A blue "How it works" link opens a modal listing the shortcuts (see Shortcuts).

Choose Video opens a file picker (`accept="video/*"`). Drag and drop onto the page also works.
If the browser cannot play the file (`canPlayType` empty, or the `error` event fires),
show a clear message naming the file and suggesting mp4/H.264 or webm.

Continue Session: the browser cannot reopen a file by itself, so the card asks the user to
pick the same file again. If the picked file's fingerprint does not match, show
"That doesn't look like the same video (expected name, size)" with options
"Use it anyway" (keeps clips) or "Pick another".

### Editor (`/edit`)

Layout (desktop first, max width 1100px, centered, black background):

- Top bar: back chevron (left) saves the session and returns home. Right: orange pill
  "Join N Clips (m:ss)" showing the clip count and total clipped duration; disabled in phase 1.
  Next to it a "+" icon button (adds a 2 s clip at the playhead, selected, for manual edit) and a
  list icon with the clip count that opens the Clips panel.
- Video: 16:9 letterboxed area. A small centered "2× speed" label with a fast-forward icon
  appears above the video while fast playback is active (held or sticky), otherwise hidden.
- Scrubber: full-width track. Grey base, orange segments for saved clips, a lighter orange
  segment from the open start marker to the playhead while marking, white round playhead.
  Click to seek, drag the playhead to scrub (video pauses while dragging and resumes if it was
  playing). Hover shows a time tooltip. Below the track: current time left (with an orange
  "2×" tag when fast), "m:ss total" right.
- Bottom controls, three columns: left an orange pill "‹ Clip N ›" (prev / next clip;
  shows "‹ — ›" when no clips), center the big round mark button, right a play/pause button.
- Clips panel: a slide-up sheet (desktop: right-side drawer) titled "Clips (N)" with a Done
  button. Each row: "Clip N" in orange, "start → end" below in grey, duration right-aligned,
  an orange "Edit" pill. Clicking the row seeks to the clip start and selects it. Rows are
  sorted by start time and renumbered after any change.
- Clip editor: opened by Edit. Shows start and end with ±1 s and ±0.1 s nudge buttons, a
  "Set to playhead" button for each, a "Preview" button that plays only this clip, a red
  "Delete" button, and Done. Start must stay ≥ 0, end ≤ duration, end − start ≥ 0.2 s;
  nudges that would break a rule are disabled rather than clamped silently.

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
- Deleting a clip from the editor sheet or with Delete/Backspace shows a 5 s toast with Undo.

## Playback

- Speed: hold the pointer (mouse or touch) on the right third of the video for 2× while held,
  like TikTok; release returns to 1×. Clicking the speed label or pressing `S` cycles a sticky
  speed 1× → 1.5× → 2× → 1×.
- Seeking clamps to [0, duration]. All seeks go through one `seek(t)` helper.
- Prev/next clip seeks to the target clip's start, selects it, and keeps the current play state.
  "Next" from after the last clip wraps to the first; "Prev" within the first 1 s of a clip goes
  to the previous clip, otherwise to the current clip's start (music-player rule).
- Clicking the video (left two thirds) toggles play/pause.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Mark start / mark end |
| K or click video | Play / pause |
| ← / → | Seek −5 s / +5 s |
| Shift+← / Shift+→ | Seek −1 s / +1 s |
| J / L | Seek −10 s / +10 s |
| , / . | Step one frame back / forward while paused (assume 30 fps) |
| ↑ / ↓ or [ / ] | Previous / next clip |
| S | Cycle sticky speed 1× / 1.5× / 2× |
| Hold pointer on right third of video | 2× while held |
| E | Edit selected clip |
| Delete / Backspace | Delete selected clip |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo / redo |
| Esc | Cancel open marker, close sheet |
| ? | Show shortcuts |

Shortcuts are ignored while focus is in a text input. Space must not scroll the page or
trigger a focused button; call `preventDefault` and keep focus off the control buttons after
clicks (blur them) so Space always means "mark".

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
  `#1C1C1E`. Sheets have 24px top radius and a drag handle bar.
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
phase 1. "Export JSON" in the Clips panel downloads this object as `<video name>.clips.json`.

## Testing

- Vitest unit tests for `src/lib/`: clip insertion and sorting, overlap detection and merging,
  prev/next clip selection rules, nudge validation, time formatting, fingerprint matching,
  undo/redo reducer transitions.
- No end-to-end tests in phase 1. Verify the editor by hand in the browser with a real video.

## Done means

- `pnpm install && pnpm dev` serves the app; `pnpm test`, `pnpm lint`, `pnpm build` pass.
- In the browser: load a video, mark three clips with Space, navigate them with the pill and
  arrow keys, edit one, delete one and undo it, reload the page, continue the session by picking
  the same file, and see the same clips.
- `README.md` documents setup and the shortcut table.

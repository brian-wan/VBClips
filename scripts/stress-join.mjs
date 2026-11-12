// Join stress test (developer tool, not CI). Joins ten 12 s clips from a 25-minute 1080p30
// recording and eight from an 8-minute 1080p60 one, in Fast and Precise mode, through the built
// app in headless Chrome, then checks every output with ffprobe. Exits non-zero on any failure.
//
//   node scripts/stress-join.mjs [--media <dir>] [--out <dir>] [--only 30|60]
//     [--modes fast,precise] [--port 4173] [--check-only]
//
// Recordings are generated with ffmpeg into --media (default: <os temp>/vbclipper-stress) when
// absent; joined outputs go to --out (default: <media>/out). Neither may be inside the repo.
// --check-only re-runs the ffprobe checks on the outputs already in --out without joining.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'
const CDP_PORT = 9360
const JOIN_TIMEOUT_MS = 40 * 60 * 1000

const { values: opts } = parseArgs({
  options: {
    media: { type: 'string', default: join(tmpdir(), 'vbclipper-stress') },
    out: { type: 'string' },
    only: { type: 'string' },
    modes: { type: 'string', default: 'fast,precise' },
    port: { type: 'string', default: '4173' },
    'check-only': { type: 'boolean', default: false },
  },
})
const MEDIA = resolve(opts.media)
const OUT = resolve(opts.out ?? join(MEDIA, 'out'))
for (const dir of [MEDIA, OUT]) {
  if (dir === REPO || dir.startsWith(REPO + '/')) throw new Error(`${dir} is inside the repo`)
}
const MODES = opts.modes.split(',')
const PORT = Number(opts.port)
const APP = `http://localhost:${PORT}/`

/**
 * Clips start on a 0.1 s mark, a frame boundary at 30 and 60 fps, and last 12 s, so a Precise
 * join holds exactly 12 s per clip and a Fast one exactly `end - keyframe`.
 */
const spread = (count, first, step) =>
  Array.from({ length: count }, (_, i) => {
    const start = first + i * step + ((i * 3 + 1) % 10) / 10
    return [start, start + 12]
  })

const RECORDINGS = [
  { name: 'long30', fps: 30, seconds: 1500, clips: spread(10, 40, 145) },
  { name: 'long60', fps: 60, seconds: 480, clips: spread(8, 20, 56) },
].filter((r) => !opts.only || r.name.endsWith(opts.only))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 }).toString()

function ensureRecording({ name, fps, seconds }) {
  const path = join(MEDIA, `${name}.mp4`)
  if (existsSync(path)) return path
  log(`generating ${path} (${seconds} s, 1080p${fps}); this takes a few minutes`)
  mkdirSync(MEDIA, { recursive: true })
  const partial = join(MEDIA, `${name}.partial.mp4`)
  run(FFMPEG, [
    ...['-loglevel', 'error', '-y'],
    ...['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${fps}`],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:beep_factor=4:sample_rate=44100'],
    ...['-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    // A keyframe every second and nowhere else, like a phone recording.
    ...['-g', String(fps), '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '128k'],
    ...['-movflags', '+faststart', partial],
  ])
  renameSync(partial, path)
  return path
}

async function startPreview() {
  log('building')
  run('pnpm', ['--dir', REPO, 'build'])
  const server = spawn('pnpm', ['--dir', REPO, 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: true,
  })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(APP)).ok) return server
    } catch {
      // not up yet
    }
    await sleep(200)
  }
  throw new Error(`pnpm preview did not answer on ${APP}`)
}

async function launchChrome(profile) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--window-size=1440,900',
    'about:blank',
  ])
  let url
  for (let i = 0; i < 100 && !url; i++) {
    try {
      url = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json())
        .webSocketDebuggerUrl
    } catch {
      await sleep(200)
    }
  }
  const ws = new WebSocket(url)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) (listeners.get(msg.method) ?? []).forEach((f) => f(msg.params))
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const n = ++id
      pending.set(n, (msg) =>
        msg.error ? rej(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : res(msg.result),
      )
      ws.send(JSON.stringify({ id: n, method, params, sessionId }))
    })
  const on = (method, f) => listeners.set(method, [...(listeners.get(method) ?? []), f])
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)
  const evaluate = async (expression) => {
    const r = await page('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600))
    return r.result.value
  }
  const waitFor = async (expression, timeoutMs, label) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await evaluate(expression)) return
      await sleep(250)
    }
    throw new Error(`timed out waiting for ${label}`)
  }
  const setFiles = async (files) => {
    const { root } = await page('DOM.getDocument', { depth: -1 })
    const { nodeId } = await page('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type=file]',
    })
    await page('DOM.setFileInputFiles', { nodeId, files })
  }
  const KEYS = { ' ': ['Space', 32], ArrowRight: ['ArrowRight', 39], k: ['KeyK', 75] }
  const key = async (k) => {
    const [code, keyCode] = KEYS[k]
    const base = { key: k, code, windowsVirtualKeyCode: keyCode }
    await page('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: k.length === 1 ? k : undefined,
      ...base,
    })
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(100)
  }
  const downloads = new Map()
  on('Browser.downloadProgress', (p) => {
    if (p.state === 'completed' || p.state === 'canceled') downloads.set(p.guid, p.state)
  })
  await page('Page.enable')
  await page('DOM.enable')
  await page('Runtime.enable')
  const close = () => {
    ws.close()
    chrome.kill()
  }
  return { send, evaluate, waitFor, setFiles, key, downloads, close }
}

const clickButton = (c, pattern, scope = 'document') =>
  c.evaluate(`(() => {
    const b = [...${scope}.querySelectorAll('button')].find((b) => ${pattern}.test(b.textContent.trim()))
    if (b) b.click()
    return !!b
  })()`)

/** Opens `source` in the editor with exactly `clips`, through a saved session. */
async function openWithClips(c, source, clips) {
  const inEditor = `location.pathname === '/edit' && document.querySelector('video')?.readyState >= 1`
  await c.evaluate(`location.href = ${JSON.stringify(APP)}`)
  await sleep(500)
  await c.waitFor(`!!document.querySelector('input[type=file]')`, 20000, 'home')
  await c.evaluate('localStorage.clear()')
  await c.setFiles([source])
  await c.waitFor(inEditor, 120000, 'editor')
  for (const k of [' ', 'ArrowRight', ' ', 'k']) await c.key(k)
  await clickButton(c, '/^Home/')
  await c.waitFor(`/Continue Session/.test(document.body.innerText)`, 10000, 'saved session')
  await c.evaluate(`(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('vbclipper:session:'))
    const session = JSON.parse(localStorage.getItem(key))
    const sourceId = session.sources[0].id
    session.clips = ${JSON.stringify(clips)}.map(([start, end], i) => ({ id: 'c' + i, sourceId, start, end }))
    localStorage.setItem(key, JSON.stringify(session))
  })()`)
  // Home reads the saved session when it mounts, so reload it to pick up the new clips.
  await c.evaluate('location.reload()')
  await sleep(500)
  await c.waitFor(
    `/ContinueSession${clips.length}clips/i.test(document.body.innerText.replace(/\\s+/g, ''))`,
    20000,
    'injected session',
  )
  await clickButton(c, '/^Continue Session/')
  await c.setFiles([source])
  await c.waitFor(inEditor, 120000, 'editor with clips')
  const joinButton = `([...document.querySelectorAll('button')].find((b) => /^Join \\d/.test(b.textContent.trim()))?.textContent.trim() ?? '')`
  await c
    .waitFor(`${joinButton}.startsWith('Join ${clips.length} Clips')`, 10000, 'join button')
    .catch(async (error) => {
      throw new Error(`${error.message}; the editor shows "${await c.evaluate(joinButton)}"`)
    })
}

/** Runs one join in `mode`; resolves to the downloaded file's path and the wall time. */
async function joinOnce(c, mode, outPath) {
  await clickButton(c, '/^Join \\d/')
  await c.waitFor(`!!document.querySelector('[role=dialog] input[value=${mode}]')`, 5000, 'dialog')
  await c.evaluate(`document.querySelector('[role=dialog] input[value=${mode}]').click()`)
  log(`${mode}: ${await c.evaluate(`document.querySelector('[role=dialog] p')?.innerText`)}`)
  const before = new Set(c.downloads.keys())
  const t0 = Date.now()
  await clickButton(c, '/^Join \\d/', `document.querySelector('[role=dialog]')`)
  const end = `(() => {
    const text = document.querySelector('[role=dialog]')?.innerText ?? ''
    return /Saved \\S+\\.mp4/.test(text) || /Check the log/.test(text)
  })()`
  await c.waitFor(end, JOIN_TIMEOUT_MS, `${mode} join`)
  const seconds = (Date.now() - t0) / 1000
  const text = await c.evaluate(`document.querySelector('[role=dialog]').innerText`)
  if (/Check the log/.test(text)) throw new Error(`${mode} join failed:\n${text}`)
  const start = Date.now()
  let guid
  while (!guid && Date.now() - start < 120000) {
    guid = [...c.downloads.entries()].find(([g, s]) => !before.has(g) && s === 'completed')?.[0]
    if (!guid) await sleep(250)
  }
  if (!guid) throw new Error(`${mode} join: the download did not complete`)
  renameSync(join(OUT, guid), outPath)
  await clickButton(c, '/^Done$/', `document.querySelector('[role=dialog]')`)
  await sleep(300)
  return seconds
}

const probeJson = (path, args) =>
  JSON.parse(run(FFPROBE, ['-v', 'error', '-of', 'json', ...args, path]))

/** Sorted presentation times of the video packets. */
function videoTimes(path, interval) {
  const args = ['-select_streams', 'v', '-show_entries', 'packet=pts_time,flags']
  if (interval) args.push('-read_intervals', interval)
  return probeJson(path, args).packets.map((p) => ({
    t: Number(p.pts_time),
    key: p.flags.startsWith('K'),
  }))
}

function keyframeAtOrBefore(source, time) {
  const packets = videoTimes(source, `${Math.max(0, time - 3)}%${time + 0.01}`)
  const keys = packets.filter((p) => p.key && p.t <= time + 1e-6).map((p) => p.t)
  return Math.max(...keys)
}

function streamTimes(path) {
  const j = probeJson(path, [
    '-show_entries',
    'format=duration:stream=codec_type,start_time,duration',
  ])
  const stream = (type) => j.streams.find((s) => s.codec_type === type)
  const span = (s) => ({ start: Number(s.start_time), duration: Number(s.duration) })
  return {
    container: Number(j.format.duration),
    video: span(stream('video')),
    audio: span(stream('audio')),
  }
}

/** Grabs the frame shown at `time` (a quarter frame before it is safe from rounding). */
function grab(path, time, fps, png) {
  run(FFMPEG, [
    '-loglevel',
    'error',
    '-y',
    '-ss',
    (time - 0.25 / fps).toFixed(6),
    '-i',
    path,
    '-frames:v',
    '1',
    png,
  ])
}

function ssim(a, b) {
  const args = ['-i', a, '-i', b, '-filter_complex', 'ssim', '-f', 'null', '-']
  const { stderr } = spawnSync(FFMPEG, args, { encoding: 'utf8' })
  return Number(stderr.match(/All:([0-9.]+)/)?.[1] ?? 'NaN')
}

const ms = (s) => s * 1000

function check(recording, source, mode, output, seconds) {
  const { fps, clips } = recording
  const frame = 1 / fps
  const failures = []
  const times = videoTimes(output)
    .map((p) => p.t)
    .sort((a, b) => a - b)
  const intervals = times.slice(1).map((t, i) => t - times[i])
  const off = intervals.filter((d) => Math.abs(d - frame) > 0.001)
  const duplicates = intervals.filter((d) => d < 0.0005).length
  if (off.length) failures.push(`${off.length} intervals off the ${ms(frame).toFixed(2)} ms frame`)
  if (duplicates) failures.push(`${duplicates} duplicate timestamps`)

  const { container, video, audio } = streamTimes(output)
  const videoEnd = video.start + video.duration
  const audioEnd = audio.start + audio.duration
  if (Math.abs(container - videoEnd) > 0.025) failures.push('container end over 25 ms from video')
  if (Math.abs(audioEnd - videoEnd) > 0.025) failures.push('audio end over 25 ms from video')

  const keyframes = clips.map(([start]) => keyframeAtOrBefore(source, start))
  const lengths = clips.map(([start, end], i) =>
    mode === 'fast' ? end - keyframes[i] : end - start,
  )
  const expected = lengths.reduce((a, b) => a + b, 0)
  const tolerance = mode === 'fast' ? 0.05 : 0.005
  if (Math.abs(video.duration - expected) > tolerance) {
    failures.push(`total ${video.duration.toFixed(3)} s, expected ${expected.toFixed(3)} s`)
  }

  const scratch = mkdtempSync(join(OUT, 'frames-'))
  let offset = 0
  const against = (sourceTime) => {
    grab(source, sourceTime, fps, join(scratch, 'src.png'))
    return ssim(join(scratch, 'out.png'), join(scratch, 'src.png'))
  }
  const scores = clips.map(([start], i) => {
    const sourceTime = (mode === 'fast' ? keyframes[i] : start) + 4
    const outputTime = video.start + Math.round((offset + 4) * fps) / fps
    offset += lengths[i]
    grab(output, outputTime, fps, join(scratch, 'out.png'))
    const score = against(sourceTime)
    // Re-encoding costs Precise about 0.02 of SSIM on this sharp test pattern, so it must instead
    // match its own source frame better than the frames either side of it.
    const neighbours = mode === 'precise' ? [-frame, frame].map((d) => against(sourceTime + d)) : []
    return { score, aligned: neighbours.every((n) => score > n) }
  })
  rmSync(scratch, { recursive: true, force: true })
  const minimum = mode === 'fast' ? 0.98 : 0.97
  const low = scores.filter(({ score }) => !(score >= minimum)).length
  const misaligned = scores.filter(({ aligned }) => !aligned).length
  if (low) failures.push(`${low} clips with SSIM under ${minimum}`)
  if (misaligned) failures.push(`${misaligned} clips closer to a neighbouring source frame`)

  return {
    recording: recording.name,
    mode,
    frames: times.length,
    intervals: `${ms(Math.min(...intervals)).toFixed(2)}..${ms(Math.max(...intervals)).toFixed(2)} ms, ${off.length} off`,
    duplicates,
    'container-video ms': ms(container - videoEnd).toFixed(1),
    'audio-video ms': ms(audioEnd - videoEnd).toFixed(1),
    'total s': video.duration.toFixed(3),
    'expected s': expected.toFixed(3),
    'ssim min': Math.min(...scores.map(({ score }) => score)).toFixed(4),
    ssim: scores.map(({ score, aligned }) => score.toFixed(3) + (aligned ? '' : '!')).join(' '),
    'join s': seconds === null ? '-' : seconds.toFixed(1),
    result: failures.length ? `FAIL: ${failures.join('; ')}` : 'pass',
  }
}

const rows = []
let server
let chrome
try {
  const sources = RECORDINGS.map((r) => ensureRecording(r))
  mkdirSync(OUT, { recursive: true })
  if (opts['check-only']) {
    for (const [i, recording] of RECORDINGS.entries()) {
      for (const mode of MODES) {
        const output = join(OUT, `${recording.name}-${mode}.mp4`)
        log(`${recording.name}: checking ${output}`)
        rows.push(check(recording, sources[i], mode, output, null))
      }
    }
  } else {
    await joinAll(sources)
  }
} catch (error) {
  rows.push({ result: `FAIL: ${error.message}` })
} finally {
  chrome?.close()
  if (server) process.kill(-server.pid)
  for (const entry of existsSync(OUT) ? run('ls', [OUT]).split('\n') : []) {
    if (entry.startsWith('profile-')) rmSync(join(OUT, entry), { recursive: true, force: true })
  }
}

/** Joins every recording in every mode through the app and checks each output. */
async function joinAll(sources) {
  server = await startPreview()
  chrome = await launchChrome(mkdtempSync(join(OUT, 'profile-')))
  await chrome.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: OUT,
    eventsEnabled: true,
  })
  for (const [i, recording] of RECORDINGS.entries()) {
    const source = sources[i]
    log(`${recording.name}: opening with ${recording.clips.length} clips`)
    await openWithClips(chrome, source, recording.clips)
    for (const mode of MODES) {
      const output = join(OUT, `${recording.name}-${mode}.mp4`)
      log(`${recording.name}: ${mode} join`)
      const seconds = await joinOnce(chrome, mode, output)
      log(`${recording.name}: ${mode} joined in ${seconds.toFixed(1)} s, checking`)
      rows.push(check(recording, source, mode, output, seconds))
    }
  }
}

console.table(rows.map(({ ssim: _, ...row }) => row))
for (const row of rows.filter((r) => r.ssim))
  console.log(`SSIM ${row.recording} ${row.mode}: ${row.ssim}`)
const failed = rows.some((r) => r.result !== 'pass')
console.log(failed ? 'stress-join: FAILED' : 'stress-join: all checks passed')
process.exit(failed ? 1 : 0)

function splitHms(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return { h, m, s }
}

function sanitize(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** `m:ss` under an hour, `h:mm:ss` otherwise. Truncates partial seconds like a player clock. */
export function formatTime(seconds: number): string {
  const { h, m, s } = splitHms(Math.floor(sanitize(seconds)))
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

/** Like `formatTime` with one decimal (`m:ss.t`), rounded to the nearest tenth. */
export function formatTimePrecise(seconds: number): string {
  const tenths = Math.round(sanitize(seconds) * 10)
  const { h, m, s } = splitHms(Math.floor(tenths / 10))
  const t = tenths % 10
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}.${t}` : `${m}:${pad2(s)}.${t}`
}

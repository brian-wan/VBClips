export const SPEEDS = [1, 1.5, 2] as const

/** The `S` key: 1× → 1.5× → 2× → 1×. An unknown speed restarts the cycle at 1×. */
export function nextSpeed(speed: number): number {
  const index = SPEEDS.findIndex((s) => s === speed)
  return SPEEDS[(index + 1) % SPEEDS.length]
}

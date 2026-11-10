/** Text for files being opened: the name for one, a running count for several. */
export function openingLabel(names: readonly string[], done: number): string {
  if (names.length === 1) return `Opening ${names[0]}…`
  return `Opening ${Math.min(done + 1, names.length)} of ${names.length}…`
}

export type Opening = { names: string[]; done: number }

/** Adds a batch of files to an opening in progress, or starts one. */
export function startOpening(current: Opening | null, names: readonly string[]): Opening {
  return current
    ? { ...current, names: [...current.names, ...names] }
    : { names: [...names], done: 0 }
}

/** One more file probed; null once every file is done. */
export function advanceOpening(current: Opening | null): Opening | null {
  if (!current) return null
  const done = current.done + 1
  return done >= current.names.length ? null : { ...current, done }
}

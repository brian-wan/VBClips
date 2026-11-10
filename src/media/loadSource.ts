import type { LoadedSource } from '../App'
import { sourceMeta } from '../lib/session'
import { canProbablyPlay } from '../playable'
import { probeDuration } from './probe'

/** Reads the file's duration; null when the browser cannot play it. */
export async function loadSource(file: File): Promise<LoadedSource | null> {
  if (!canProbablyPlay(file)) return null
  const duration = await probeDuration(file)
  return duration === null ? null : { meta: sourceMeta(file, duration), file }
}

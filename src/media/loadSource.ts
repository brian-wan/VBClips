import type { LoadedSource } from '../App'
import { sourceMeta } from '../lib/session'
import { canProbablyPlay, type OpenFailure } from '../playable'
import { probeDuration } from './probe'

/** Reads the file's duration, or says why the file did not open. */
export async function loadSource(file: File): Promise<LoadedSource | OpenFailure> {
  if (!canProbablyPlay(file)) return 'unplayable'
  const duration = await probeDuration(file)
  return typeof duration === 'number' ? { meta: sourceMeta(file, duration), file } : duration
}

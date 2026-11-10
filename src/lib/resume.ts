import { fingerprint, type VideoIdentity } from './fingerprint'
import type { SavedSession } from './persistence'
import type { SourceMeta } from './session'

export type SourceMatch<F> =
  /** A one-video save and a picked file that is not it: offer "Use it anyway". */
  | { kind: 'mismatch'; file: F }
  | {
      kind: 'matched'
      /** Saved source id to picked file, including the files found by earlier picks. */
      found: Map<string, F>
      /** Saved sources still without a file; "Open without them" makes sense once `found` has any. */
      missing: SourceMeta[]
      /** Every source has its file, so the session opens at once. */
      complete: boolean
    }

/** Matches newly picked `files` to a saved session's sources by fingerprint, for Continue Session. */
export function matchSavedSources<F extends VideoIdentity>(
  session: Pick<SavedSession, 'sources'>,
  found: ReadonlyMap<string, F>,
  files: readonly F[],
): SourceMatch<F> {
  const ids = new Set(session.sources.map((s) => s.id))
  const matched = files.filter((file) => ids.has(fingerprint(file)))
  const [first] = files
  if (session.sources.length === 1 && matched.length === 0 && first) {
    return { kind: 'mismatch', file: first }
  }
  const next = new Map(found)
  for (const file of matched) next.set(fingerprint(file), file)
  const missing = session.sources.filter((s) => !next.has(s.id))
  return { kind: 'matched', found: next, missing, complete: missing.length === 0 }
}

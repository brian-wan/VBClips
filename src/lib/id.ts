/**
 * A random id for a new clip. `crypto.randomUUID` exists only in secure contexts, so a page
 * served over plain http on a LAN falls back to 128 random bits as hex.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

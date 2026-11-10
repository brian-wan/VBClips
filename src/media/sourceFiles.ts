/**
 * The editor's picked files and their object URLs. Files are kept for the editor's lifetime so
 * undoing a removal can bring a source back; each URL is created when its source is in the
 * timeline and revoked when the source leaves it or the editor unmounts.
 */
export class SourceFiles {
  private readonly files = new Map<string, File>()
  private readonly urls = new Map<string, string>()
  private pendingRevoke: number | undefined

  add(id: string, file: File): void {
    if (!this.files.has(id)) this.files.set(id, file)
  }

  file(id: string): File | undefined {
    return this.files.get(id)
  }

  url(id: string): string | undefined {
    const existing = this.urls.get(id)
    if (existing) return existing
    const file = this.files.get(id)
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    this.urls.set(id, url)
    return url
  }

  /** Revokes the URLs of every source not in `ids`. */
  retain(ids: ReadonlySet<string>): void {
    for (const [id, url] of this.urls) {
      if (ids.has(id)) continue
      URL.revokeObjectURL(url)
      this.urls.delete(id)
    }
  }

  /**
   * Revokes every URL on the next tick unless `keep` is called first. React's development mode
   * unmounts and remounts each component once; deferring keeps that from breaking live URLs.
   */
  releaseSoon(): void {
    window.clearTimeout(this.pendingRevoke)
    this.pendingRevoke = window.setTimeout(() => this.retain(new Set()), 0)
  }

  keep(): void {
    window.clearTimeout(this.pendingRevoke)
  }
}

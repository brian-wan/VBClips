/** Starts a browser download of `url` (an object URL) saved as `fileName`. */
export function downloadUrl(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
}

export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  downloadUrl(url, fileName)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Starts a browser download of `url` (an object URL) saved as `fileName`. */
export function downloadUrl(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
}

export function unplayableMessage(fileName: string): string {
  return `“${fileName}” can’t be played in this browser. Try an MP4 (H.264) or WebM video.`
}

/** False only when the browser says outright it cannot play the file's declared type. */
export function canProbablyPlay(file: File): boolean {
  if (!file.type) return true
  if (!file.type.startsWith('video/')) return false
  return document.createElement('video').canPlayType(file.type) !== ''
}

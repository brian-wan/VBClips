export function unplayableMessage(fileName: string): string {
  return `“${fileName}” can’t be played in this browser. Try an MP4 (H.264), MOV or WebM video.`
}

/** Why a picked file did not open: the browser cannot play it, or reading it took too long. */
export type OpenFailure = 'unplayable' | 'timeout'

export function openFailureMessage(fileName: string, failure: OpenFailure): string {
  return failure === 'timeout'
    ? `${fileName} took too long to open. If it is stored in iCloud, download it first and try again.`
    : unplayableMessage(fileName)
}

/**
 * False only for files whose declared type is not video at all. Container types such as
 * `video/quicktime` get an empty `canPlayType` answer in Chrome even when the codecs inside
 * play fine, so the real test is the video element's `error` event after loading.
 */
export function canProbablyPlay(file: File): boolean {
  return !file.type || file.type.startsWith('video/')
}

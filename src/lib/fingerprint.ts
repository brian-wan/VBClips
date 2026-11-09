export type VideoIdentity = { name: string; size: number; lastModified: number }

export function fingerprint(video: VideoIdentity): string {
  return `${video.name}|${video.size}|${video.lastModified}`
}

export function sameVideo(a: VideoIdentity, b: VideoIdentity): boolean {
  return fingerprint(a) === fingerprint(b)
}

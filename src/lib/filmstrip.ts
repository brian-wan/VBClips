/** Width of one timeline filmstrip frame. */
export const TIMELINE_TILE_PX = 64
/** Width of one trim strip frame. */
export const TRIM_TILE_PX = 48

export function tileCount(width: number, tileWidth: number): number {
  if (!(width > 0) || !(tileWidth > 0)) return 0
  return Math.ceil(width / tileWidth)
}

/** `count` evenly spaced times inside [start, end], one at the middle of each tile. */
export function tileTimes(start: number, end: number, count: number): number[] {
  const length = end - start
  if (count <= 0 || !(length > 0)) return []
  return Array.from({ length: count }, (_, k) =>
    roundThumbTime(start + ((k + 0.5) * length) / count),
  )
}

/** Thumbnails are cached per tenth of a second. */
export function roundThumbTime(t: number): number {
  return Math.round(t * 10) / 10
}

export function thumbKey(sourceId: string, t: number): string {
  return `${sourceId}@${roundThumbTime(t).toFixed(1)}`
}

/** The tile set is recomputed only when the strip has grown or shrunk by more than one tile. */
export function shouldRelayout(laidOutWidth: number, width: number, tileWidth: number): boolean {
  return Math.abs(width - laidOutWidth) > tileWidth
}

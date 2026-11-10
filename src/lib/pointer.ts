/** Hit-test distances in CSS px, larger for a finger than for a mouse. */
export type PointerTolerance = {
  /** Distance from a selected clip's edge on the timeline that still grabs its trim handle. */
  handle: number
  /** Distance from the playhead that grabs it for scrubbing. */
  playhead: number
  /** Width the trim strip draws its handles at; they sit just outside the clip. */
  trimHandleWidth: number
  /** Distance from a trim strip handle's centre that still grabs it. */
  trimHandle: number
}

const FINE: PointerTolerance = { handle: 8, playhead: 6, trimHandleWidth: 8, trimHandle: 12 }

/**
 * A 44px touch target is 22px either side of a handle. The playhead only grows a little: on
 * touch a grab and a tap on the bare strip both scrub, so a wide playhead would only take taps
 * meant for the clip segments around it.
 */
const COARSE: PointerTolerance = { handle: 22, playhead: 12, trimHandleWidth: 12, trimHandle: 22 }

export const COARSE_POINTER_QUERY = '(pointer: coarse)'

export function toleranceFor(coarse: boolean): PointerTolerance {
  return coarse ? COARSE : FINE
}

export function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia(COARSE_POINTER_QUERY).matches
}

/** The tolerances for the device's primary pointer, read when a pointer event needs them. */
export function pointerTolerance(): PointerTolerance {
  return toleranceFor(isCoarsePointer())
}

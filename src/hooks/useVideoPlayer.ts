import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clamp } from '../lib/clips'
import { locate, toSequence, totalDuration, type Location } from '../lib/sequence'

export type PlayerSource = { id: string; duration: number; url: string | undefined }

export type VideoPlayer = {
  /** Sequence time. */
  currentTime: number
  /** Sum of all source durations. */
  duration: number
  paused: boolean
  /** The source under the playhead (-1 without sources) and the local time inside it. */
  location: Location
  /** Where the playhead is right now, read from the element rather than the last render. */
  now: () => Location & { time: number }
  /** Seeks to a sequence time, swapping sources when it lies in another one. */
  seek: (t: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  /** Plays [start, end] (sequence time, inside one source) once and pauses at the end. */
  playRange: (start: number, end: number) => void
}

const END_EPSILON = 0.05

/**
 * One `<video>` element plays the sources back to back. At the end of a source it swaps `src`
 * to the next one and keeps playing; after the last it pauses at the end.
 */
export function useVideoPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  sources: readonly PlayerSource[],
  initialTime: number,
): VideoPlayer {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [localTime, setLocalTime] = useState(0)
  const [paused, setPaused] = useState(true)

  const sourcesRef = useRef(sources)
  const currentIdRef = useRef<string | null>(null)
  const lastIndex = useRef(0)
  const loadedUrl = useRef<string | null>(null)
  const pendingSeek = useRef<number | null>(null)
  const lastLocal = useRef(0)
  const stopAt = useRef<number | null>(null)
  const initialTimeRef = useRef(initialTime)

  useEffect(() => {
    sourcesRef.current = sources
  })

  const indexOf = (id: string | null) => sourcesRef.current.findIndex((s) => s.id === id)

  /** Shows `index` at `local`, swapping `src` if needed; playback resumes if `autoplay`. */
  const goTo = useCallback(
    (index: number, local: number, autoplay: boolean) => {
      const video = videoRef.current
      const source = sourcesRef.current[index]
      if (!video || !source) return
      stopAt.current = null
      currentIdRef.current = source.id
      lastIndex.current = index
      lastLocal.current = local
      setCurrentId(source.id)
      setLocalTime(local)
      if (source.url && loadedUrl.current !== source.url) {
        loadedUrl.current = source.url
        pendingSeek.current = local
        video.src = source.url
      } else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        video.currentTime = local
      } else {
        pendingSeek.current = local
      }
      if (autoplay) void video.play().catch(() => undefined)
    },
    [videoRef],
  )

  // Keep the element on a source that still exists when sources are added, removed or moved.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (sources.length === 0) {
      if (loadedUrl.current !== null) {
        loadedUrl.current = null
        video.removeAttribute('src')
        video.load()
      }
      currentIdRef.current = null
      return
    }
    const index = sources.findIndex((s) => s.id === currentIdRef.current)
    if (index >= 0) {
      lastIndex.current = index
      const source = sources[index]
      if (source.url && loadedUrl.current !== source.url) {
        goTo(index, lastLocal.current, !video.paused)
      }
      return
    }
    if (currentIdRef.current === null && loadedUrl.current === null) {
      const start = locate(sources, initialTimeRef.current)
      goTo(start.index, start.localTime, false)
    } else {
      goTo(clamp(lastIndex.current, 0, sources.length - 1), 0, !video.paused)
    }
  }, [sources, videoRef, goTo])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0

    const hasNext = () => {
      const index = indexOf(currentIdRef.current)
      return index >= 0 && index < sourcesRef.current.length - 1
    }

    const sync = () => {
      if (stopAt.current !== null && video.currentTime >= stopAt.current) {
        video.pause()
        video.currentTime = stopAt.current
        stopAt.current = null
      }
      // While a swapped-in source loads, the element reports 0; show where it is headed.
      const local = pendingSeek.current ?? video.currentTime
      lastLocal.current = local
      setLocalTime(local)
    }
    const tick = () => {
      sync()
      frame = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setPaused(false)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    const atEnd = () =>
      video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration)
    const onPause = () => {
      cancelAnimationFrame(frame)
      // The element pauses on its own at the end of each source; advancing resumes it.
      if (atEnd() && hasNext() && stopAt.current === null) return
      setPaused(true)
      sync()
    }
    const onEnded = () => {
      const index = indexOf(currentIdRef.current)
      if (stopAt.current === null && index >= 0 && index < sourcesRef.current.length - 1) {
        goTo(index + 1, 0, true)
      } else {
        setPaused(true)
        sync()
      }
    }
    const onMetadata = () => {
      if (pendingSeek.current !== null) {
        const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0
        video.currentTime = clamp(pendingSeek.current, 0, Math.max(0, sourceDuration - END_EPSILON))
        pendingSeek.current = null
      }
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('seeked', sync)
    video.addEventListener('timeupdate', sync)
    video.addEventListener('loadedmetadata', onMetadata)
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('seeked', sync)
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('loadedmetadata', onMetadata)
    }
  }, [videoRef, goTo])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video) return
      loadedUrl.current = null
      video.removeAttribute('src')
      video.load()
    }
  }, [videoRef])

  const now = useCallback(() => {
    const list = sourcesRef.current
    const index = list.findIndex((s) => s.id === currentIdRef.current)
    const video = videoRef.current
    const local = pendingSeek.current ?? video?.currentTime ?? 0
    if (index < 0) return { index: -1, localTime: 0, time: 0 }
    return { index, localTime: local, time: toSequence(list, index, local) }
  }, [videoRef])

  const seek = useCallback(
    (t: number) => {
      const list = sourcesRef.current
      if (list.length === 0) return
      const target = locate(list, clamp(t, 0, totalDuration(list)))
      const video = videoRef.current
      goTo(target.index, target.localTime, video ? !video.paused : false)
    },
    [videoRef, goTo],
  )

  const play = useCallback(() => {
    void videoRef.current?.play().catch(() => undefined)
  }, [videoRef])

  const pause = useCallback(() => videoRef.current?.pause(), [videoRef])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video || sourcesRef.current.length === 0) return
    if (video.paused) play()
    else video.pause()
  }, [videoRef, play])

  const playRange = useCallback(
    (start: number, end: number) => {
      const list = sourcesRef.current
      const from = locate(list, start)
      if (from.index < 0) return
      goTo(from.index, from.localTime, true)
      stopAt.current = from.localTime + (end - start)
    },
    [goTo],
  )

  const index = sources.findIndex((s) => s.id === currentId)
  const location =
    index >= 0 ? { index, localTime } : { index: sources.length ? 0 : -1, localTime: 0 }

  return {
    currentTime: location.index >= 0 ? toSequence(sources, location.index, location.localTime) : 0,
    duration: totalDuration(sources),
    paused,
    location,
    now,
    seek,
    play,
    pause,
    toggle,
    playRange,
  }
}

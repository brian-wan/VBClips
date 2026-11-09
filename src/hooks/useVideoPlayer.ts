import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clampToDuration } from '../lib/clips'

export type VideoPlayer = {
  currentTime: number
  duration: number
  paused: boolean
  seek: (t: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  /** Plays [start, end] once and pauses at the end. Any manual seek cancels it. */
  playRange: (start: number, end: number) => void
}

export function useVideoPlayer(videoRef: RefObject<HTMLVideoElement | null>): VideoPlayer {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(true)
  const stopAt = useRef<number | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0

    const sync = () => {
      if (stopAt.current !== null && video.currentTime >= stopAt.current) {
        video.pause()
        video.currentTime = stopAt.current
        stopAt.current = null
      }
      setCurrentTime(video.currentTime)
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
    const onPause = () => {
      setPaused(true)
      cancelAnimationFrame(frame)
      sync()
    }
    const onDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0)

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('seeked', sync)
    video.addEventListener('timeupdate', sync)
    video.addEventListener('loadedmetadata', onDuration)
    video.addEventListener('durationchange', onDuration)
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('seeked', sync)
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('loadedmetadata', onDuration)
      video.removeEventListener('durationchange', onDuration)
    }
  }, [videoRef])

  const seek = useCallback(
    (t: number) => {
      const video = videoRef.current
      if (!video) return
      stopAt.current = null
      const target = clampToDuration(t, Number.isFinite(video.duration) ? video.duration : 0)
      video.currentTime = target
      setCurrentTime(target)
    },
    [videoRef],
  )

  const play = useCallback(() => {
    void videoRef.current?.play().catch(() => undefined)
  }, [videoRef])

  const pause = useCallback(() => videoRef.current?.pause(), [videoRef])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) play()
    else video.pause()
  }, [videoRef, play])

  const playRange = useCallback(
    (start: number, end: number) => {
      seek(start)
      stopAt.current = end
      play()
    },
    [seek, play],
  )

  return { currentTime, duration, paused, seek, play, pause, toggle, playRange }
}

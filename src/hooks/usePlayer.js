import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../api'

export function usePlayer() {
  const audioRef                = useRef(new Audio())
  const queueRef                = useRef([])
  const indexRef                = useRef(-1)
  const [queue, setQueue]       = useState([])
  const [index, setIndex]       = useState(-1)
  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume]     = useState(1)
  const [loading, setLoading]   = useState(false)
  const [shuffle, setShuffle]   = useState(false)

  const current = queue[index] ?? null

  useEffect(() => { audioRef.current.volume = volume }, [volume])

  // Синхронизируем рефы с состоянием для колбэков
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { indexRef.current = index }, [index])

  const playAtIndex = useCallback((ni) => {
    const track = queueRef.current[ni]
    if (!track) return
    const url = api.streamUrl(track)
    if (!url) return
    const a = audioRef.current
    a.src = url
    a.load()
    a.play().catch(() => {})
    setIndex(ni)
    indexRef.current = ni
  }, [])

  const next = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    let ni
    if (shuffle) {
      ni = Math.floor(Math.random() * q.length)
    } else {
      ni = indexRef.current + 1 < q.length ? indexRef.current + 1 : 0
    }
    playAtIndex(ni)
  }, [shuffle, playAtIndex])

  const prev = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    const pi = indexRef.current - 1 >= 0 ? indexRef.current - 1 : q.length - 1
    playAtIndex(pi)
  }, [playAtIndex])

  // События аудио
  useEffect(() => {
    const a = audioRef.current
    const onTime     = () => setProgress(a.duration ? a.currentTime / a.duration : 0)
    const onDuration = () => setDuration(a.duration || 0)
    const onPlay     = () => setPlaying(true)
    const onPause    = () => setPlaying(false)
    const onEnded    = () => next()
    const onWaiting  = () => setLoading(true)
    const onCanPlay  = () => setLoading(false)

    a.addEventListener('timeupdate',     onTime)
    a.addEventListener('durationchange', onDuration)
    a.addEventListener('play',           onPlay)
    a.addEventListener('pause',          onPause)
    a.addEventListener('ended',          onEnded)
    a.addEventListener('waiting',        onWaiting)
    a.addEventListener('canplay',        onCanPlay)
    return () => {
      a.removeEventListener('timeupdate',     onTime)
      a.removeEventListener('durationchange', onDuration)
      a.removeEventListener('play',           onPlay)
      a.removeEventListener('pause',          onPause)
      a.removeEventListener('ended',          onEnded)
      a.removeEventListener('waiting',        onWaiting)
      a.removeEventListener('canplay',        onCanPlay)
    }
  }, [next])

  const playTrack = useCallback(async (track, newQueue = null) => {
    const a = audioRef.current
    if (newQueue) {
      setQueue(newQueue)
      queueRef.current = newQueue
      const i = newQueue.findIndex(t => t.id === track.id)
      const ni = i >= 0 ? i : 0
      setIndex(ni)
      indexRef.current = ni
    }
    setLoading(true)
    const url = api.streamUrl(track)
    if (!url) { setLoading(false); return }
    a.src = url
    a.load()
    try { await a.play() } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a.src) return
    playing ? a.pause() : a.play()
  }, [playing])

  const seek = useCallback((ratio) => {
    const a = audioRef.current
    if (a.duration) a.currentTime = ratio * a.duration
  }, [])

  const toggleShuffle = useCallback(() => setShuffle(s => !s), [])

  return {
    current, queue, playing, progress, duration, volume, loading, shuffle,
    playTrack, togglePlay, seek, next, prev, setVolume, toggleShuffle
  }
}

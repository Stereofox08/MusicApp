import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../api'

export function usePlayer() {
  const audioRef              = useRef(new Audio())
  const [queue, setQueue]     = useState([])
  const [index, setIndex]     = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)   // 0..1
  const [duration, setDuration] = useState(0)
  const [volume, setVolume]     = useState(1)
  const [loading, setLoading]   = useState(false)

  const current = queue[index] ?? null

  // Синхронизируем volume
  useEffect(() => { audioRef.current.volume = volume }, [volume])

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

    a.addEventListener('timeupdate',  onTime)
    a.addEventListener('durationchange', onDuration)
    a.addEventListener('play',        onPlay)
    a.addEventListener('pause',       onPause)
    a.addEventListener('ended',       onEnded)
    a.addEventListener('waiting',     onWaiting)
    a.addEventListener('canplay',     onCanPlay)
    return () => {
      a.removeEventListener('timeupdate',     onTime)
      a.removeEventListener('durationchange', onDuration)
      a.removeEventListener('play',           onPlay)
      a.removeEventListener('pause',          onPause)
      a.removeEventListener('ended',          onEnded)
      a.removeEventListener('waiting',        onWaiting)
      a.removeEventListener('canplay',        onCanPlay)
    }
  }, []) // eslint-disable-line

  const playTrack = useCallback(async (track, newQueue = null) => {
    const a = audioRef.current
    if (newQueue) {
      setQueue(newQueue)
      const i = newQueue.findIndex(t => t.id === track.id)
      setIndex(i >= 0 ? i : 0)
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

  const next = useCallback(() => {
    setIndex(i => {
      const ni = i + 1 < queue.length ? i + 1 : 0
      const track = queue[ni]
      if (track) {
        const url = api.streamUrl(track)
        if (url) { audioRef.current.src = url; audioRef.current.play().catch(() => {}) }
      }
      return ni
    })
  }, [queue])

  const prev = useCallback(() => {
    setIndex(i => {
      const pi = i - 1 >= 0 ? i - 1 : queue.length - 1
      const track = queue[pi]
      if (track) {
        const url = api.streamUrl(track)
        if (url) { audioRef.current.src = url; audioRef.current.play().catch(() => {}) }
      }
      return pi
    })
  }, [queue])

  return { current, queue, playing, progress, duration, volume, loading,
           playTrack, togglePlay, seek, next, prev, setVolume, setQueue, setIndex }
}

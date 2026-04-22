import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

export function useLibrary() {
  const [tracks,    setTracks]    = useState([])
  const [playlists, setPlaylists] = useState([])
  const [loading,   setLoading]   = useState(false)

  const loadTracks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getTracks()
      setTracks(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await api.getPlaylists()
      setPlaylists(Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    loadTracks()
    loadPlaylists()
  }, [loadTracks, loadPlaylists])

  const saveTrack = useCallback(async (track) => {
    const exists = tracks.find(t => t.sc_id === track.id)
    if (exists) return exists
    const saved = await api.saveTrack(track)
    setTracks(prev => [saved, ...prev])
    return saved
  }, [tracks])

  const deleteTrack = useCallback(async (id) => {
    await api.deleteTrack(id)
    setTracks(prev => prev.filter(t => t.id !== id))
  }, [])

  const createPlaylist = useCallback(async (name) => {
    const pl = await api.createPlaylist(name)
    setPlaylists(prev => [pl, ...prev])
    return pl
  }, [])

  const deletePlaylist = useCallback(async (id) => {
    await api.deletePlaylist(id)
    setPlaylists(prev => prev.filter(p => p.id !== id))
  }, [])

  const addToPlaylist = useCallback(async (playlist_id, track) => {
    const savedTrack = await saveTrack(track)
    await api.addToPlaylist(playlist_id, savedTrack.id)
  }, [saveTrack])

  return {
    tracks, playlists, loading,
    loadTracks, loadPlaylists,
    saveTrack, deleteTrack,
    createPlaylist, deletePlaylist,
    addToPlaylist,
  }
}

import React, { useState, useCallback } from 'react'
import TrackItem from './TrackItem'
import { api } from '../api'

export default function SearchTab({ player, library }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const search = useCallback(async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.search(query)
      setResults(Array.isArray(data) ? data : [])
    } catch (e) {
      setError('Ошибка поиска: ' + e.message)
    }
    setLoading(false)
  }, [query])

  const handleShuffle = () => {
    if (results.length === 0) return
    const shuffled = [...results].sort(() => Math.random() - 0.5)
    player.playTrack(shuffled[0], shuffled)
  }

  const savedIds = new Set(library.tracks.map(t => t.sc_id).filter(Boolean))

  return (
    <div className="tab-content">
      <form className="search-form" onSubmit={search}>
        <input
          className="search-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск на SoundCloud..."
          autoFocus
        />
        <button className="search-btn" type="submit" disabled={loading}>
          {loading ? '...' : '🔍'}
        </button>
        {results.length > 0 && (
          <button className="search-btn" type="button" onClick={handleShuffle} title="Shuffle">
            🔀
          </button>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      <div className="track-list">
        {results.map(track => (
          <TrackItem
            key={track.id}
            track={track}
            isPlaying={player.current?.id === track.id}
            onPlay={() => player.playTrack(track, results)}
            onSave={() => library.saveTrack(track)}
            onAddToPlaylist={(plId) => library.addToPlaylist(plId, track)}
            playlists={library.playlists}
            saved={savedIds.has(track.id)}
          />
        ))}
      </div>
    </div>
  )
}

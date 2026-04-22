import React, { useState, useEffect } from 'react'
import TrackItem from './TrackItem'
import { api } from '../api'

export default function PlaylistsTab({ player, library }) {
  const [selected,  setSelected]  = useState(null) // playlist id
  const [tracks,    setTracks]    = useState([])
  const [newName,   setNewName]   = useState('')
  const [creating,  setCreating]  = useState(false)

  useEffect(() => {
    if (!selected) return
    api.getPlaylistTracks(selected).then(data => setTracks(Array.isArray(data) ? data : []))
  }, [selected])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    await library.createPlaylist(newName.trim())
    setNewName('')
    setCreating(false)
  }

  const currentPlaylist = library.playlists.find(p => p.id === selected)

  return (
    <div className="tab-content">
      {!selected ? (
        <>
          <div className="playlist-header">
            <h3>Плейлисты</h3>
            <button className="btn-primary" onClick={() => setCreating(v => !v)}>+ Новый</button>
          </div>

          {creating && (
            <form className="search-form" onSubmit={handleCreate} style={{ marginBottom: 12 }}>
              <input
                className="search-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Название плейлиста..."
                autoFocus
              />
              <button className="search-btn" type="submit">✓</button>
            </form>
          )}

          {library.playlists.length === 0
            ? <div className="empty">Нет плейлистов — создай первый!</div>
            : (
              <div className="playlist-list">
                {library.playlists.map(pl => (
                  <div key={pl.id} className="playlist-item" onClick={() => setSelected(pl.id)}>
                    <div className="playlist-icon">🎵</div>
                    <div className="playlist-name">{pl.name}</div>
                    <button className="icon-btn icon-btn--danger"
                      onClick={e => { e.stopPropagation(); library.deletePlaylist(pl.id) }}>✕</button>
                  </div>
                ))}
              </div>
            )
          }
        </>
      ) : (
        <>
          <div className="playlist-header">
            <button className="btn-back" onClick={() => setSelected(null)}>← Назад</button>
            <h3>{currentPlaylist?.name}</h3>
          </div>

          {tracks.length === 0
            ? <div className="empty">Плейлист пуст — добавь треки из поиска или библиотеки</div>
            : (
              <div className="track-list">
                {tracks.map(track => (
                  <TrackItem
                    key={track.id}
                    track={track}
                    isPlaying={player.current?.id === track.id}
                    onPlay={() => player.playTrack(track, tracks)}
                    onDelete={async () => {
                      await api.removeFromPlaylist(selected, track.id)
                      setTracks(prev => prev.filter(t => t.id !== track.id))
                    }}
                  />
                ))}
              </div>
            )
          }
        </>
      )}
    </div>
  )
}

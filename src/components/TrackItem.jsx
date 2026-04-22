import React, { useState } from 'react'

function fmt(sec) {
  if (!sec) return ''
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

export default function TrackItem({ track, isPlaying, onPlay, onSave, onDelete, onAddToPlaylist, playlists, saved }) {
  const [showMenu, setShowMenu] = useState(false)
  const artwork = track.artwork_url || track.artwork

  return (
    <div className={`track-item ${isPlaying ? 'track-item--playing' : ''}`}>
      <img
        className="track-art"
        src={artwork || '/placeholder.svg'}
        alt=""
        onError={e => { e.target.src = '/placeholder.svg' }}
        onClick={onPlay}
      />
      <div className="track-info" onClick={onPlay}>
        <div className="track-title">{track.title}</div>
        <div className="track-artist">{track.artist} {track.duration ? `· ${fmt(track.duration)}` : ''}</div>
      </div>

      <div className="track-actions">
        {isPlaying && <span className="playing-indicator">▶</span>}

        {onSave && !saved && (
          <button className="icon-btn" title="Сохранить в библиотеку" onClick={onSave}>＋</button>
        )}
        {saved && <span className="saved-mark" title="В библиотеке">✓</span>}

        {onAddToPlaylist && playlists?.length > 0 && (
          <div className="menu-wrap">
            <button className="icon-btn" onClick={() => setShowMenu(v => !v)}>≡</button>
            {showMenu && (
              <div className="dropdown">
                <div className="dropdown-label">Добавить в плейлист:</div>
                {playlists.map(pl => (
                  <button key={pl.id} className="dropdown-item"
                    onClick={() => { onAddToPlaylist(pl.id); setShowMenu(false) }}>
                    {pl.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onDelete && (
          <button className="icon-btn icon-btn--danger" title="Удалить" onClick={onDelete}>✕</button>
        )}
      </div>
    </div>
  )
}

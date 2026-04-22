import React, { useState, useRef } from 'react'
import TrackItem from './TrackItem'
import { api } from '../api'

export default function LibraryTab({ player, library }) {
  const [uploading,    setUploading]    = useState(false)
  const [uploadProgress, setProgress]  = useState(0)
  const [filter,       setFilter]      = useState('')
  const fileInputRef                   = useRef()

  const handleFiles = async (files) => {
    if (!files?.length) return
    setUploading(true)
    let done = 0
    for (const file of Array.from(files)) {
      try {
        setProgress(Math.round((done / files.length) * 100))
        // Парсим имя файла как "Artist - Title" если возможно
        const name   = file.name.replace(/\.[^.]+$/, '')
        const parts  = name.split(' - ')
        const title  = parts.length >= 2 ? parts.slice(1).join(' - ') : name
        const artist = parts.length >= 2 ? parts[0] : 'Unknown'
        await api.uploadTrack(file, title, artist)
        done++
      } catch (e) {
        console.error('Upload error:', e)
      }
    }
    setUploading(false)
    setProgress(0)
    library.loadTracks()
  }

  const filtered = library.tracks.filter(t =>
    !filter || t.title?.toLowerCase().includes(filter.toLowerCase()) ||
               t.artist?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="tab-content">
      {/* Загрузка файлов */}
      <div
        className="upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
      >
        {uploading
          ? <span>Загрузка... {uploadProgress}%</span>
          : <span>📂 Нажми или перетащи MP3/FLAC файлы</span>
        }
        <input
          ref={fileInputRef} type="file" multiple hidden
          accept="audio/*"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* Фильтр */}
      {library.tracks.length > 0 && (
        <input
          className="search-input"
          style={{ marginBottom: 12 }}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Фильтр по названию или исполнителю..."
        />
      )}

      {library.loading
        ? <div className="empty">Загрузка...</div>
        : filtered.length === 0
          ? <div className="empty">Библиотека пуста — загрузи треки или сохрани из поиска</div>
          : (
            <div className="track-list">
              {filtered.map(track => (
                <TrackItem
                  key={track.id}
                  track={track}
                  isPlaying={player.current?.id === track.id || player.current?.id === track.sc_id}
                  onPlay={() => player.playTrack(
                    { ...track, stream_url: track.stream_url, file_url: track.file_url },
                    filtered
                  )}
                  onDelete={() => library.deleteTrack(track.id)}
                  onAddToPlaylist={(plId) => library.addToPlaylist(plId, track)}
                  playlists={library.playlists}
                />
              ))}
            </div>
          )
      }
    </div>
  )
}

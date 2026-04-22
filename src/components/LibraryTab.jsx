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
    const total = files.length
    let done = 0

    for (const file of Array.from(files)) {
      try {
        setProgress(Math.round((done / total) * 100))

        // Парсим имя файла как "Artist - Title"
        const name   = file.name.replace(/\.[^.]+$/, '')
        const parts  = name.split(' - ')
        const title  = parts.length >= 2 ? parts.slice(1).join(' - ') : name
        const artist = parts.length >= 2 ? parts[0] : 'Unknown'

        // Шаг 1: получаем presigned URL от бэкенда
        const presignRes = await fetch('/api/presign', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ fileName: file.name, contentType: file.type || 'audio/mpeg' }),
        })
        const { uploadUrl, fileUrl, key, r2Token } = await presignRes.json()

        // Шаг 2: загружаем файл напрямую в R2 (минуя Vercel)
        await fetch(uploadUrl, {
          method:  'PUT',
          headers: {
            'Authorization': `Bearer ${r2Token}`,
            'Content-Type':  file.type || 'audio/mpeg',
          },
          body: file,
        })

        // Шаг 3: сохраняем метаданные в Supabase через бэкенд
        await fetch('/api/save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ title, artist, fileUrl, fileName: key }),
        })

        done++
      } catch (e) {
        console.error('Upload error:', file.name, e)
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

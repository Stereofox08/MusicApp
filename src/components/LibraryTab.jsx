import React, { useState, useRef } from 'react'
import TrackItem from './TrackItem'
import { api } from '../api'

async function readMp3Tags(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try { resolve(parseID3(new Uint8Array(e.target.result))) }
      catch { resolve({}) }
    }
    reader.readAsArrayBuffer(file.slice(0, 256 * 1024))
  })
}

function parseID3(buf) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return {}
  const version = buf[3]
  let offset = 10
  const result = {}
  while (offset < buf.length - 10) {
    const frameId = String.fromCharCode(buf[offset], buf[offset+1], buf[offset+2], buf[offset+3])
    if (frameId === '\0\0\0\0') break
    const size = version >= 4
      ? ((buf[offset+4]&0x7f)<<21)|((buf[offset+5]&0x7f)<<14)|((buf[offset+6]&0x7f)<<7)|(buf[offset+7]&0x7f)
      : (buf[offset+4]<<24)|(buf[offset+5]<<16)|(buf[offset+6]<<8)|buf[offset+7]
    if (size <= 0 || size > 1000000) break
    const frameData = buf.slice(offset + 10, offset + 10 + size)
    if (frameId === 'TIT2') result.title  = decodeText(frameData)
    if (frameId === 'TPE1') result.artist = decodeText(frameData)
    if (frameId === 'APIC') result.artwork = extractArtwork(frameData)
    offset += 10 + size
  }
  return result
}

function decodeText(data) {
  const enc = data[0], content = data.slice(1)
  try {
    if (enc === 0) return new TextDecoder('iso-8859-1').decode(content).replace(/\0/g,'').trim()
    if (enc === 1) return new TextDecoder('utf-16').decode(content).replace(/\0/g,'').trim()
    return new TextDecoder('utf-8').decode(content).replace(/\0/g,'').trim()
  } catch { return '' }
}

function extractArtwork(data) {
  try {
    let i = 1
    while (i < data.length && data[i] !== 0) i++
    i++; i++
    while (i < data.length && data[i] !== 0) i++
    i++
    return URL.createObjectURL(new Blob([data.slice(i)]))
  } catch { return null }
}

export default function LibraryTab({ player, library }) {
  const [uploading,  setUploading]  = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [filter,     setFilter]     = useState('')
  const fileInputRef                = useRef()

  const handleFiles = async (files) => {
    if (!files?.length) return
    setUploading(true)
    const total = files.length
    let done = 0
    for (const file of Array.from(files)) {
      try {
        setProgress(Math.round((done / total) * 100))
        const tags   = await readMp3Tags(file)
        const name   = file.name.replace(/\.[^.]+$/, '')
        const parts  = name.split(' - ')
        const title  = tags.title  || (parts.length >= 2 ? parts.slice(1).join(' - ') : name)
        const artist = tags.artist || (parts.length >= 2 ? parts[0] : 'Unknown')

        let artworkUrl = null
        if (tags.artwork) {
          const artPresign = await fetch('/api/presign', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: `art_${Date.now()}.jpg`, contentType: 'image/jpeg' }),
          }).then(r => r.json())
          const artBlob = await fetch(tags.artwork).then(r => r.blob())
          await fetch(artPresign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: artBlob })
          artworkUrl = artPresign.fileUrl
          URL.revokeObjectURL(tags.artwork)
        }

        const presignRes = await fetch('/api/presign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, contentType: file.type || 'audio/mpeg' }),
        })
        const { uploadUrl, fileUrl, key } = await presignRes.json()
        await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file })
        await fetch('/api/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, artist, fileUrl, fileName: key, artworkUrl }),
        })
        done++
      } catch (e) { console.error('Upload error:', file.name, e) }
    }
    setUploading(false)
    setProgress(0)
    library.loadTracks()
  }

  const filtered = library.tracks.filter(t =>
    !filter ||
    t.title?.toLowerCase().includes(filter.toLowerCase()) ||
    t.artist?.toLowerCase().includes(filter.toLowerCase())
  )

  const handleShuffle = () => {
    if (filtered.length === 0) return
    const shuffled = [...filtered].sort(() => Math.random() - 0.5)
    player.playTrack(shuffled[0], shuffled)
  }

  return (
    <div className="tab-content">
      <div
        className="upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
      >
        {uploading ? <span>Загрузка... {progress}%</span> : <span>📂 Нажми или перетащи MP3/FLAC файлы</span>}
        <input ref={fileInputRef} type="file" multiple hidden accept="audio/*"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {library.tracks.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="search-input" style={{ flex: 1 }}
            value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Поиск по библиотеке..." />
          <button className="search-btn" onClick={handleShuffle} title="Shuffle">🔀</button>
        </div>
      )}

      {library.loading
        ? <div className="empty">Загрузка...</div>
        : filtered.length === 0
          ? <div className="empty">{filter ? 'Ничего не найдено' : 'Библиотека пуста — загрузи треки или сохрани из поиска'}</div>
          : (
            <div className="track-list">
              {filtered.map(track => (
                <TrackItem
                  key={track.id}
                  track={track}
                  isPlaying={player.current?.id === track.id}
                  onPlay={() => player.playTrack(track, filtered)}
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

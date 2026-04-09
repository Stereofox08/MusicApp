import React, { useState, useEffect, useRef } from 'react';
import { api } from './api.js';
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const fmt = (s) => {
  if (!s) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

function EqBars({ active }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 18, marginRight: 8 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          display: 'block', width: 3, background: 'var(--accent)', borderRadius: 2,
          height: active ? undefined : 6,
          animation: active ? `eq ${0.6 + i * 0.15}s ease-in-out infinite alternate` : 'none',
          animationDelay: `${i * 0.1}s`
        }} />
      ))}
    </span>
  );
}

function TrackRow({ track, isPlaying, isCurrent, onPlay, onDelete, onSave, isSaving }) {
  const isYT = track.source === 'youtube';
  const isSaved = track.source === 'youtube_saved';

  const badgeBg = isYT ? 'rgba(255,0,0,0.15)' : isSaved ? 'rgba(200,240,96,0.1)' : 'rgba(124,106,240,0.15)';
  const badgeColor = isYT ? '#ff4444' : isSaved ? 'var(--accent)' : '#7c6af0';
  const badgeLabel = isYT ? 'YT' : isSaved ? 'YT✓' : 'MY';

  return (
    <div onClick={onPlay} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px', borderRadius: 'var(--radius)',
      background: isCurrent ? 'var(--surface2)' : 'transparent',
      border: isCurrent ? '1px solid var(--border)' : '1px solid transparent',
      cursor: 'pointer', transition: 'background 0.15s',
      animation: 'slideUp 0.3s ease both'
    }}
      onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--surface)'; }}
      onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
        background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: isCurrent ? '2px solid var(--accent)' : '2px solid transparent'
      }}>
        {(track.artwork || track.artwork_url)
          ? <img src={track.artwork || track.artwork_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 20 }}>♪</span>
        }
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {isCurrent && <EqBars active={isPlaying} />}
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
            color: isCurrent ? 'var(--accent)' : 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{track.title}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{track.artist}</div>
      </div>

      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 20,
        background: badgeBg, color: badgeColor,
        fontWeight: 600, letterSpacing: 0.5, flexShrink: 0
      }}>{badgeLabel}</span>

      {track.duration && (
        <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, width: 36, textAlign: 'right' }}>
          {fmt(track.duration)}
        </span>
      )}

      {/* YouTube результат — кнопка сохранить в библиотеку */}
      {isYT && onSave && (
        <button onClick={e => { e.stopPropagation(); onSave(track); }} disabled={isSaving} style={{
          width: 32, height: 32, borderRadius: 8, background: 'var(--surface2)',
          color: isSaving ? 'var(--muted)' : '#7c6af0', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }} title="Сохранить в библиотеку">
          {isSaving ? '…' : '＋'}
        </button>
      )}

      {/* Своя музыка — кнопка удалить */}
      {!isYT && onDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete(track.id); }} style={{
          width: 28, height: 28, borderRadius: 6, background: 'var(--surface2)',
          color: 'var(--muted)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'color 0.15s'
        }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
        >✕</button>
      )}
    </div>
  );
}

function PlayerBar({ track, audioRef, isPlaying, setIsPlaying }) {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const progressRef = useRef();

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime);
    const onDur = () => setDuration(a.duration || 0);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDur);
    a.addEventListener('durationchange', onDur);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDur);
      a.removeEventListener('durationchange', onDur);
    };
  }, [audioRef]);

  const seek = (e) => {
    const rect = progressRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  if (!track) return null;
  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(20px)',
      borderTop: '1px solid var(--border)', padding: '12px 24px 16px',
      display: 'flex', flexDirection: 'column', gap: 10, zIndex: 100
    }}>
      <div ref={progressRef} onClick={seek} style={{
        height: 3, background: 'var(--surface2)', borderRadius: 2, cursor: 'pointer', position: 'relative'
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s linear'
        }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)',
          left: `${pct}%`, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)',
          opacity: pct > 0 ? 1 : 0
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{track.artist}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(progress)}</span>
          <button onClick={() => {
            if (isPlaying) audioRef.current.pause();
            else audioRef.current.play();
            setIsPlaying(!isPlaying);
          }} style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--accent)', color: '#000',
            fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.15s'
          }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(duration)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 14 }}>🔊</span>
          <input type="range" min="0" max="1" step="0.01" value={volume}
            onChange={e => { const v = parseFloat(e.target.value); setVolume(v); audioRef.current.volume = v; }}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  );
}

function UploadModal({ onClose, onUploaded }) {
  const [files, setFiles] = useState([]); // [{ file, title, artist, status }]
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const inputStyle = {
    flex: 1, padding: '6px 10px', borderRadius: 6,
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 0
  };

  const addFiles = (newFiles) => {
    const audioFiles = Array.from(newFiles).filter(f => f.type.startsWith('audio/'));
    setFiles(prev => [
      ...prev,
      ...audioFiles.map(f => ({
        file: f,
        title: f.name.replace(/\.[^.]+$/, ''),
        artist: '',
        status: 'pending', // pending | uploading | done | error
      }))
    ]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => setFiles(f => f.filter((_, i) => i !== idx));

  const updateFile = (idx, key, val) =>
    setFiles(f => f.map((item, i) => i === idx ? { ...item, [key]: val } : item));

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'done') continue;
      updateFile(i, 'status', 'uploading');
      try {
        const track = await api.uploadTrack(files[i].file, files[i].title, files[i].artist);
        if (track.error) throw new Error(track.error);
        onUploaded(track);
        updateFile(i, 'status', 'done');
      } catch {
        updateFile(i, 'status', 'error');
      }
    }

    setUploading(false);
    // Закрываем только если все успешно
    setFiles(prev => {
      if (prev.every(f => f.status === 'done')) setTimeout(onClose, 600);
      return prev;
    });
  };

  const pendingCount = files.filter(f => f.status !== 'done').length;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16,
        animation: 'slideUp 0.25s ease', maxHeight: '85vh', overflow: 'hidden'
      }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>
          Загрузить треки
        </h2>

        {/* Drop zone */}
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '20px 16px', borderRadius: 10,
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            cursor: 'pointer', transition: 'all 0.2s',
            background: dragOver ? 'rgba(200,240,96,0.06)' : 'transparent',
            flexShrink: 0
          }}>
          <span style={{ fontSize: 28 }}>🎵</span>
          <span style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
            Кликни или перетащи сюда MP3/WAV/FLAC<br />
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Можно выбрать несколько файлов сразу</span>
          </span>
          <input type="file" accept="audio/*" multiple style={{ display: 'none' }}
            onChange={e => addFiles(e.target.files)} />
        </label>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280 }}>
            {files.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 8,
                background: item.status === 'done' ? 'rgba(200,240,96,0.06)' :
                            item.status === 'error' ? 'rgba(255,80,80,0.06)' : 'var(--surface2)',
                border: `1px solid ${item.status === 'done' ? 'rgba(200,240,96,0.2)' :
                                     item.status === 'error' ? 'rgba(255,80,80,0.2)' : 'var(--border)'}`,
              }}>
                {/* Status icon */}
                <span style={{ fontSize: 16, flexShrink: 0 }}>
                  {item.status === 'done' ? '✓' :
                   item.status === 'error' ? '✕' :
                   item.status === 'uploading' ? '↻' : '♪'}
                </span>

                {/* Title & Artist inputs */}
                <input style={inputStyle} value={item.title}
                  onChange={e => updateFile(i, 'title', e.target.value)}
                  placeholder="Название" disabled={item.status === 'uploading' || item.status === 'done'} />
                <input style={{ ...inputStyle, maxWidth: 120 }} value={item.artist}
                  onChange={e => updateFile(i, 'artist', e.target.value)}
                  placeholder="Артист" disabled={item.status === 'uploading' || item.status === 'done'} />

                {/* Remove */}
                {item.status !== 'uploading' && item.status !== 'done' && (
                  <button onClick={() => removeFile(i)} style={{
                    width: 24, height: 24, borderRadius: 6, background: 'transparent',
                    color: 'var(--muted)', fontSize: 14, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', borderRadius: 8, border: '1px solid var(--border)',
            color: 'var(--muted)', fontSize: 14
          }}>Отмена</button>
          <button onClick={handleSubmit} disabled={uploading || files.length === 0} style={{
            flex: 2, padding: '12px', borderRadius: 8,
            background: uploading || files.length === 0 ? 'var(--border)' : 'var(--accent)',
            color: '#000', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)',
          }}>
            {uploading ? `Загружаю...` : `Загрузить${pendingCount > 1 ? ` (${pendingCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('library');
  const [tracks, setTracks] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const audioRef = useRef(new Audio());

  useEffect(() => {
    api.getTracks()
      .then(data => setTracks(Array.isArray(data) ? data : []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!currentTrack) return;
    const audio = audioRef.current;

    const play = async (url) => {
      audio.src = url;
      audio.load();
      try { await audio.play(); setIsPlaying(true); } catch { setIsPlaying(false); }
    };

if (currentTrack.source === 'youtube' && currentTrack.youtube_id) {
  play(`${BASE}/stream?id=${currentTrack.youtube_id}`);
} else {
  play(currentTrack.file_url);
}

    audio.onended = () => setIsPlaying(false);
  }, [currentTrack]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await api.searchMusic(searchQuery);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleSave = async (track) => {
    if (saving[track.id]) return;
    setSaving(s => ({ ...s, [track.id]: true }));
    try {
      const saved = await api.saveTrack(track);
      if (!saved.error) {
        setTracks(t => [saved, ...t]);
        alert(`"${track.title}" сохранён в библиотеку!`);
      }
    } catch { alert('Не удалось сохранить трек'); }
    finally { setSaving(s => ({ ...s, [track.id]: false })); }
  };

  const handleDelete = async (id) => {
    await api.deleteTrack(id);
    setTracks(t => t.filter(x => x.id !== id));
    if (currentTrack?.id === id) { audioRef.current.pause(); setCurrentTrack(null); setIsPlaying(false); }
  };

  const tabStyle = (t) => ({
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
    padding: '8px 20px', borderRadius: 20,
    background: tab === t ? 'var(--accent)' : 'transparent',
    color: tab === t ? '#000' : 'var(--muted)',
    transition: 'all 0.2s', letterSpacing: 0.5
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '24px 32px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 24
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: -1 }}>
          <span style={{ color: 'var(--accent)' }}>♪</span> MusicApp
        </h1>

        <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', padding: 4, borderRadius: 24, border: '1px solid var(--border)' }}>
          <button style={tabStyle('library')} onClick={() => setTab('library')}>Моя библиотека</button>
          <button style={tabStyle('search')} onClick={() => setTab('search')}>Поиск музыки</button>
        </div>

        <button onClick={() => setShowUpload(true)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 20,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
          transition: 'border-color 0.2s'
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <span style={{ fontSize: 16 }}>↑</span> Загрузить трек
        </button>
      </header>

      <main style={{ flex: 1, padding: '24px 32px', paddingBottom: 120, maxWidth: 900, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>

        {tab === 'library' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--muted)' }}>
                {tracks.length} треков
              </h2>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>
                <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>↻</div>
                <div style={{ marginTop: 12 }}>Загружаем библиотеку...</div>
              </div>
            ) : tracks.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
                <div style={{ fontSize: 48 }}>🎵</div>
                <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 18 }}>Библиотека пуста</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>Загрузи свои треки или найди через поиск</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tracks.map(t => (
                  <TrackRow key={t.id} track={t}
                    isCurrent={currentTrack?.id === t.id}
                    isPlaying={isPlaying}
                    onPlay={() => setCurrentTrack(t)}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'search' && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Введи название трека или артиста..."
                style={{
                  flex: 1, padding: '14px 18px', borderRadius: 12,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 15, outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={e => e.target.style.borderColor = 'var(--accent2)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <button onClick={handleSearch} disabled={searching} style={{
                padding: '14px 28px', borderRadius: 12,
                background: 'var(--accent2)', color: '#fff',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
                transition: 'opacity 0.2s', opacity: searching ? 0.6 : 1
              }}>
                {searching ? '...' : 'Найти'}
              </button>
            </div>

            {searching && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
                <div style={{ fontSize: 28, animation: 'spin 1s linear infinite' }}>↻</div>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {searchResults.map(t => (
                  <TrackRow key={t.id} track={t}
                    isCurrent={currentTrack?.id === t.id}
                    isPlaying={isPlaying}
                    onPlay={() => setCurrentTrack(t)}
                    onSave={handleSave}
                    isSaving={!!saving[t.id]}
                  />
                ))}
              </div>
            )}

            {!searching && searchResults.length === 0 && searchQuery && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60, fontSize: 14 }}>
                Ничего не найдено
              </div>
            )}

            {!searchQuery && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
                <div style={{ fontSize: 48 }}>🎵</div>
                <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 18 }}>
                  Поиск музыки
                </div>
                <div style={{ marginTop: 8, fontSize: 14 }}>Результаты с YouTube • нажми ＋ чтобы сохранить офлайн</div>
              </div>
            )}
          </div>
        )}
      </main>

      <PlayerBar track={currentTrack} audioRef={audioRef} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={track => setTracks(t => [track, ...t])}
        />
      )}

      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
}

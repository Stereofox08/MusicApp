import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!s) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

// ── Equalizer bars ────────────────────────────────────────────────────────────
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

// ── Track row ─────────────────────────────────────────────────────────────────
function TrackRow({ track, isPlaying, isCurrent, onPlay, onDelete }) {
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
      {/* Artwork / play indicator */}
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
        background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: isCurrent ? '2px solid var(--accent)' : '2px solid transparent'
      }}>
        {track.artwork || track.artwork_url
          ? <img src={track.artwork || track.artwork_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 20 }}>♪</span>
        }
      </div>

      {/* Info */}
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

      {/* Source badge */}
      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 20,
        background: track.source === 'soundcloud' ? 'rgba(255,85,0,0.15)' : 'rgba(200,240,96,0.1)',
        color: track.source === 'soundcloud' ? '#ff5500' : 'var(--accent)',
        fontWeight: 600, letterSpacing: 0.5, flexShrink: 0
      }}>
        {track.source === 'soundcloud' ? 'SC' : 'MY'}
      </span>

      {/* Duration */}
      {track.duration && (
        <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, width: 36, textAlign: 'right' }}>
          {fmt(track.duration)}
        </span>
      )}

      {/* Delete (only uploaded) */}
      {track.source !== 'soundcloud' && (
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

// ── Player bar ────────────────────────────────────────────────────────────────
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

  const changeVolume = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    audioRef.current.volume = v;
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
      {/* Progress bar */}
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
        {/* Track info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{track.artist}</div>
        </div>

        {/* Controls */}
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

        {/* Volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 14 }}>🔊</span>
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={changeVolume}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 14, outline: 'none'
  };

  const handleSubmit = async () => {
    if (!file) return setError('Выбери файл');
    setLoading(true); setError('');
    try {
      const track = await api.uploadTrack(file, title, artist);
      if (track.error) throw new Error(track.error);
      onUploaded(track);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 32, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16,
        animation: 'slideUp 0.25s ease'
      }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>Загрузить трек</h2>

        {/* File drop zone */}
        <label style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '24px 16px', borderRadius: 10,
          border: `2px dashed ${file ? 'var(--accent)' : 'var(--border)'}`,
          cursor: 'pointer', transition: 'border-color 0.2s',
          background: file ? 'rgba(200,240,96,0.04)' : 'transparent'
        }}>
          <span style={{ fontSize: 32 }}>🎵</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            {file ? file.name : 'Кликни или перетащи MP3/WAV/FLAC'}
          </span>
          <input type="file" accept="audio/*" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files[0];
              if (f) { setFile(f); setTitle(f.name.replace(/\.[^.]+$/, '')); }
            }} />
        </label>

        <input style={inputStyle} placeholder="Название" value={title} onChange={e => setTitle(e.target.value)} />
        <input style={inputStyle} placeholder="Артист" value={artist} onChange={e => setArtist(e.target.value)} />

        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', borderRadius: 8, border: '1px solid var(--border)',
            color: 'var(--muted)', fontSize: 14
          }}>Отмена</button>
          <button onClick={handleSubmit} disabled={loading} style={{
            flex: 2, padding: '12px', borderRadius: 8,
            background: loading ? 'var(--border)' : 'var(--accent)',
            color: '#000', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)',
            transition: 'transform 0.15s'
          }}>
            {loading ? 'Загружаю...' : 'Загрузить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('library'); // 'library' | 'search'
  const [tracks, setTracks] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const audioRef = useRef(new Audio());

  // Load library
  useEffect(() => {
    api.getTracks()
      .then(data => setTracks(Array.isArray(data) ? data : []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, []);

  // Auto-play on track change
  useEffect(() => {
    if (!currentTrack) return;
    const audio = audioRef.current;

    const play = async (url) => {
      audio.src = url;
      audio.load();
      try { await audio.play(); setIsPlaying(true); } catch { setIsPlaying(false); }
    };

    if (currentTrack.source === 'soundcloud' && currentTrack.stream_url) {
      api.resolveStream(currentTrack.stream_url)
        .then(d => play(d.stream_url))
        .catch(() => setIsPlaying(false));
    } else {
      play(currentTrack.file_url);
    }

    audio.onended = () => setIsPlaying(false);
  }, [currentTrack]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await api.searchSoundCloud(searchQuery);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
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
      {/* Header */}
      <header style={{
        padding: '24px 32px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 24
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: -1 }}>
          <span style={{ color: 'var(--accent)' }}>♪</span> MusicApp
        </h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', padding: 4, borderRadius: 24, border: '1px solid var(--border)' }}>
          <button style={tabStyle('library')} onClick={() => setTab('library')}>Моя библиотека</button>
          <button style={tabStyle('search')} onClick={() => setTab('search')}>Поиск SoundCloud</button>
        </div>

        {/* Upload button */}
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

      {/* Content */}
      <main style={{ flex: 1, padding: '24px 32px', paddingBottom: 120, maxWidth: 900, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>

        {/* ── LIBRARY TAB ── */}
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
                <div style={{ marginTop: 8, fontSize: 14 }}>Загрузи треки или найди в SoundCloud</div>
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

        {/* ── SEARCH TAB ── */}
        {tab === 'search' && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Поиск по SoundCloud..."
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
                    onDelete={() => {}}
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
                <div style={{ fontSize: 48 }}>🔍</div>
                <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 18 }}>
                  Ищи треки на SoundCloud
                </div>
                <div style={{ marginTop: 8, fontSize: 14 }}>Введи название песни или артиста</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Player */}
      <PlayerBar track={currentTrack} audioRef={audioRef} isPlaying={isPlaying} setIsPlaying={setIsPlaying} />

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={track => setTracks(t => [track, ...t])}
        />
      )}

      {/* Audio element */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
}

import React from 'react'

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Player({ player }) {
  const { current, playing, progress, duration, volume, loading, shuffle,
          togglePlay, seek, next, prev, setVolume, toggleShuffle } = player

  if (!current) return null

  return (
    <div className="player">
      <div className="player-info">
        <img
          className="player-art"
          src={current.artwork_url || current.artwork || '/placeholder.svg'}
          alt=""
          onError={e => { e.target.src = '/placeholder.svg' }}
        />
        <div className="player-meta">
          <div className="player-title">{current.title}</div>
          <div className="player-artist">{current.artist}</div>
        </div>
      </div>

      <div className="player-controls">
        <button
          className="ctrl-btn"
          onClick={toggleShuffle}
          title="Shuffle"
          style={{ color: shuffle ? 'var(--accent)' : undefined }}
        >🔀</button>
        <button className="ctrl-btn" onClick={prev}>⏮</button>
        <button className="ctrl-btn play-btn" onClick={togglePlay} disabled={loading}>
          {loading ? '⏳' : playing ? '⏸' : '▶'}
        </button>
        <button className="ctrl-btn" onClick={next}>⏭</button>
      </div>

      <div className="player-progress">
        <span className="player-time">{fmt(progress * duration)}</span>
        <div
          className="progress-bar"
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            seek((e.clientX - rect.left) / rect.width)
          }}
        >
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="player-time">{fmt(duration)}</span>
      </div>

      <div className="player-volume">
        <span>🔊</span>
        <input
          type="range" min="0" max="1" step="0.02"
          value={volume}
          onChange={e => setVolume(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { usePlayer }    from './hooks/usePlayer'
import { useLibrary }   from './hooks/useLibrary'
import Player           from './components/Player'
import SearchTab        from './components/SearchTab'
import LibraryTab       from './components/LibraryTab'
import PlaylistsTab     from './components/PlaylistsTab'

const TABS = [
  { id: 'search',    label: '🔍 Поиск'     },
  { id: 'library',   label: '🎵 Библиотека' },
  { id: 'playlists', label: '📋 Плейлисты'  },
]

export default function App() {
  const [tab, setTab] = useState('search')
  const player        = usePlayer()
  const library       = useLibrary()

  return (
    <div className="app">
      <header className="header">
        <div className="logo">🎶 MusicApp</div>
        <nav className="tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'tab-btn--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {tab === 'search'    && <SearchTab    player={player} library={library} />}
        {tab === 'library'   && <LibraryTab   player={player} library={library} />}
        {tab === 'playlists' && <PlaylistsTab player={player} library={library} />}
      </main>

      <Player player={player} />
    </div>
  )
}

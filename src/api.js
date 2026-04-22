const BASE = import.meta.env.VITE_API_URL || '';

export const api = {
  // Поиск SoundCloud
  search: (q) =>
    fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=20`).then(r => r.json()),

  // Стриминг — возвращает URL для <audio>
  streamUrl: (track) => {
    if (track.source === 'soundcloud' && track.stream_url)
      return `${BASE}/api/stream?url=${encodeURIComponent(track.stream_url)}`;
    if (track.file_url)
      return track.file_url; // R2 файл — прямой публичный URL
    return null;
  },

  // Библиотека
  getTracks:    ()      => fetch(`${BASE}/api/tracks`).then(r => r.json()),
  saveTrack:    (track) => fetch(`${BASE}/api/tracks`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(track),
  }).then(r => r.json()),
  deleteTrack:  (id)    => fetch(`${BASE}/api/tracks?id=${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Загрузка файла
  uploadTrack: (file, title, artist) => {
    const form = new FormData();
    form.append('file',   file);
    form.append('title',  title  || file.name.replace(/\.[^.]+$/, ''));
    form.append('artist', artist || 'Unknown');
    return fetch(`${BASE}/api/upload`, { method: 'POST', body: form }).then(r => r.json());
  },

  // Плейлисты
  getPlaylists:       ()              => fetch(`${BASE}/api/playlists`).then(r => r.json()),
  getPlaylistTracks:  (id)            => fetch(`${BASE}/api/playlists?id=${id}`).then(r => r.json()),
  createPlaylist:     (name)          => fetch(`${BASE}/api/playlists`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(r => r.json()),
  deletePlaylist:     (id)            => fetch(`${BASE}/api/playlists?id=${id}`, { method: 'DELETE' }).then(r => r.json()),
  addToPlaylist:      (playlist_id, track_id) => fetch(`${BASE}/api/playlists/tracks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlist_id, track_id }),
  }).then(r => r.json()),
  removeFromPlaylist: (playlist_id, track_id) =>
    fetch(`${BASE}/api/playlists/tracks?playlist_id=${playlist_id}&track_id=${track_id}`, {
      method: 'DELETE',
    }).then(r => r.json()),
};

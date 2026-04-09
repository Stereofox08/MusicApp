const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  getTracks: () => fetch(`${BASE}/tracks`).then(r => r.json()),

  uploadTrack: (file, title, artist) => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', title || file.name.replace(/\.[^.]+$/, ''));
    form.append('artist', artist || 'Unknown');
    return fetch(`${BASE}/tracks/upload`, { method: 'POST', body: form }).then(r => r.json());
  },

  deleteTrack: (id) =>
    fetch(`${BASE}/tracks/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Поиск через youtube-search-python (без API ключа)
  searchMusic: (q) =>
    fetch(`${BASE}/search?q=${encodeURIComponent(q)}`).then(r => r.json()),

  // Прямая ссылка на аудио через yt-dlp
  resolveStream: (youtubeId) =>
    fetch(`${BASE}/stream?id=${encodeURIComponent(youtubeId)}`).then(r => r.json()),

  // Сохранить трек в библиотеку (скачивает mp3 → Supabase)
  saveTrack: (track) =>
    fetch(`${BASE}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_id: track.youtube_id, title: track.title, artist: track.artist }),
    }).then(r => r.json()),
};

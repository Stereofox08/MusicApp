const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  BASE,

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

  searchMusic: (q) =>
    fetch(`${BASE}/search?q=${encodeURIComponent(q)}`).then(r => r.json()),

  // VK: стримим через прокси на бэкенде
  streamUrl: (track) => {
    if (track.source === 'vk' && track.stream_url) {
      return `${BASE}/stream?url=${encodeURIComponent(track.stream_url)}`;
    }
    return track.file_url;
  },

  // Сохранить трек в библиотеку
  saveTrack: (track) =>
    fetch(`${BASE}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vk_id: track.vk_id,
        stream_url: track.stream_url,
        youtube_id: track.youtube_id,
        title: track.title,
        artist: track.artist,
      }),
    }).then(r => r.json()),
};

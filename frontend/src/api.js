const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  // Uploaded tracks
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

  // SoundCloud
  searchSoundCloud: (q) =>
    fetch(`${BASE}/soundcloud/search?q=${encodeURIComponent(q)}`).then(r => r.json()),

  resolveStream: (url) =>
    fetch(`${BASE}/soundcloud/stream?url=${encodeURIComponent(url)}`).then(r => r.json()),
};

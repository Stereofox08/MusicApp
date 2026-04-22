// GET    /api/playlists             — все плейлисты
// POST   /api/playlists             — создать плейлист { name }
// DELETE /api/playlists?id=uuid     — удалить плейлист
// POST   /api/playlists/tracks      — добавить трек в плейлист { playlist_id, track_id }
// DELETE /api/playlists/tracks      — удалить трек из плейлиста { playlist_id, track_id }
import { setCors } from './_sc.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = {
  'apikey':        SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type':  'application/json',
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...sbHeaders, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isTracksRoute = req.url?.includes('/playlists/tracks');

  try {
    // ── Треки в плейлисте ────────────────────────────────────────────────
    if (isTracksRoute) {
      if (req.method === 'POST') {
        const { playlist_id, track_id, position = 0 } = req.body;
        await sbFetch('/playlist_tracks', {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ playlist_id, track_id, position }),
        });
        return res.json({ success: true });
      }
      if (req.method === 'DELETE') {
        const { playlist_id, track_id } = req.query;
        await sbFetch(`/playlist_tracks?playlist_id=eq.${playlist_id}&track_id=eq.${track_id}`, {
          method: 'DELETE',
        });
        return res.json({ success: true });
      }
    }

    // ── Плейлисты ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        // Треки конкретного плейлиста
        const rows = await sbFetch(
          `/playlist_tracks?playlist_id=eq.${id}&order=position.asc&select=tracks(*)`
        );
        return res.json((rows || []).map(r => r.tracks).filter(Boolean));
      }
      const playlists = await sbFetch('/playlists?order=created_at.desc&select=*');
      return res.json(playlists || []);
    }

    if (req.method === 'POST') {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const playlist = await sbFetch('/playlists?select=*', {
        method:  'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ name }),
      });
      return res.json(Array.isArray(playlist) ? playlist[0] : playlist);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sbFetch(`/playlists?id=eq.${id}`, { method: 'DELETE' });
      return res.json({ success: true });
    }

    res.status(405).end();
  } catch (e) {
    console.error('[playlists]', e.message);
    res.status(500).json({ error: e.message });
  }
}

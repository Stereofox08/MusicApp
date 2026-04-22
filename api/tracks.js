// GET    /api/tracks          — все треки из библиотеки
// POST   /api/tracks          — сохранить SC трек в библиотеку
// DELETE /api/tracks?id=uuid  — удалить трек
import { setCors } from './_sc.js';

async function sbFetch(path, options = {}) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) throw new Error('Supabase env vars missing');
  const headers = {
    'apikey':        SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type':  'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(`${SB_URL}/rest/v1${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const tracks = await sbFetch('/tracks?order=created_at.desc&select=*');
      return res.json(tracks);
    }

    if (req.method === 'POST') {
      const { title, artist, duration, artwork, stream_url, permalink, sc_id } = req.body;
      const track = await sbFetch('/tracks?select=*', {
        method:  'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ title, artist, duration, artwork_url: artwork, stream_url, permalink, sc_id, source: 'soundcloud' }),
      });
      return res.json(Array.isArray(track) ? track[0] : track);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const R2_ACCOUNT = process.env.R2_ACCOUNT_ID;
      const R2_BUCKET  = process.env.R2_BUCKET_NAME;
      const R2_TOKEN   = process.env.R2_TOKEN;
      const [track] = await sbFetch(`/tracks?id=eq.${id}&select=file_name`);
      if (track?.file_name) {
        const url = `https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/${track.file_name}`;
        await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${R2_TOKEN}` } }).catch(() => {});
      }
      await sbFetch(`/tracks?id=eq.${id}`, { method: 'DELETE' });
      return res.json({ success: true });
    }

    res.status(405).end();
  } catch (e) {
    console.error('[tracks]', e.message);
    res.status(500).json({ error: e.message });
  }
}

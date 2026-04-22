// GET /api/search?q=текст&limit=20
import { scFetch, formatTrack, setCors } from './_sc.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, limit = '20' } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });

  try {
    const data   = await scFetch('/search/tracks', { q, limit, filter: 'streamable' });
    const tracks = (data.collection || [])
      .filter(t => t.streamable && t.media?.transcodings?.length)
      .map(formatTrack)
      .filter(t => t.stream_url);
    res.json(tracks);
  } catch (e) {
    console.error('[search]', e.message);
    res.status(500).json({ error: e.message });
  }
}

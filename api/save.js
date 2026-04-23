// POST /api/save
// Тело: { title, artist, fileUrl, fileName, duration }
// Вызывается после того как браузер сам загрузил файл в R2

import { setCors } from './_sc.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { title, artist, fileUrl, fileName, duration, artworkUrl } = req.body;
    if (!title || !fileUrl) return res.status(400).json({ error: 'title and fileUrl required' });

    const SB_URL = process.env.SUPABASE_URL;
    const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

    const response = await fetch(`${SB_URL}/rest/v1/tracks`, {
      method: 'POST',
      headers: {
        'apikey':        SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        title,
        artist:     artist || 'Unknown',
        file_url:   fileUrl,
        file_name:  fileName,
        duration:   duration || 0,
        artwork_url: artworkUrl || null,
        source:     'upload',
      }),
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
    const data = JSON.parse(text);
    res.json(Array.isArray(data) ? data[0] : data);
  } catch (e) {
    console.error('[save]', e.message);
    res.status(500).json({ error: e.message });
  }
}

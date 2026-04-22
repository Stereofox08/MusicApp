// POST /api/presign
// Тело: { fileName, contentType, title, artist }
// Возвращает: { uploadUrl, fileUrl, key }
// Браузер сам загружает файл по uploadUrl напрямую в R2

import { setCors } from './_sc.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { fileName, contentType } = req.body;
    if (!fileName || !contentType) return res.status(400).json({ error: 'fileName and contentType required' });

    const R2_ACCOUNT = process.env.R2_ACCOUNT_ID;
    const R2_BUCKET  = process.env.R2_BUCKET_NAME;
    const R2_TOKEN   = process.env.R2_TOKEN;
    const R2_PUBLIC  = process.env.R2_PUBLIC_URL;

    if (!R2_ACCOUNT || !R2_BUCKET || !R2_TOKEN || !R2_PUBLIC) {
      return res.status(500).json({ error: 'R2 env vars missing' });
    }

    const key       = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploadUrl = `https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;
    const fileUrl   = `${R2_PUBLIC}/${key}`;

    res.json({ uploadUrl, fileUrl, key, r2Token: R2_TOKEN });
  } catch (e) {
    console.error('[presign]', e.message);
    res.status(500).json({ error: e.message });
  }
}

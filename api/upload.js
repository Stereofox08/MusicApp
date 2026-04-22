// POST /api/upload  (multipart/form-data: file, title, artist)
// Загружает аудиофайл в Cloudflare R2 и сохраняет метаданные в Supabase
import { setCors } from './_sc.js';

const R2_ACCOUNT  = process.env.R2_ACCOUNT_ID;
const R2_BUCKET   = process.env.R2_BUCKET_NAME;
const R2_TOKEN    = process.env.R2_TOKEN;           // API Token с доступом к R2
const R2_PUBLIC   = process.env.R2_PUBLIC_URL;      // https://pub-xxx.r2.dev или свой домен
const SB_URL      = process.env.SUPABASE_URL;
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;

async function uploadToR2(buffer, fileName, contentType) {
  const url = `https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/${fileName}`;
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bearer ${R2_TOKEN}`,
      'Content-Type':  contentType,
      'Content-Length': buffer.length,
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`R2 upload ${res.status}: ${await res.text()}`);
  return `${R2_PUBLIC}/${fileName}`;
}

async function saveToSupabase(track) {
  const res = await fetch(`${SB_URL}/rest/v1/tracks`, {
    method:  'POST',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(track),
  });
  if (!res.ok) throw new Error(`Supabase insert ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  try {
    // Vercel даёт body как Buffer при правильном content-type
    // Парсим multipart вручную через встроенный formidable-like подход
    const { IncomingForm } = await import('formidable');
    const form = new IncomingForm({ maxFileSize: 150 * 1024 * 1024 });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err); else resolve({ fields, files });
      });
    });

    const file   = Array.isArray(files.file) ? files.file[0] : files.file;
    const title  = (Array.isArray(fields.title)  ? fields.title[0]  : fields.title)  || 'Unknown';
    const artist = (Array.isArray(fields.artist) ? fields.artist[0] : fields.artist) || 'Unknown';

    if (!file) return res.status(400).json({ error: 'No file' });

    const { readFile } = await import('fs/promises');
    const buffer   = await readFile(file.filepath);
    const ext      = file.originalFilename?.split('.').pop() || 'mp3';
    const fileName = `${Date.now()}_${title.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
    const fileUrl  = await uploadToR2(buffer, fileName, file.mimetype || 'audio/mpeg');

    const track = await saveToSupabase({
      title,
      artist,
      file_url:  fileUrl,
      file_name: fileName,
      source:    'upload',
    });

    res.json(Array.isArray(track) ? track[0] : track);
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: e.message });
  }
}

export const config = { api: { bodyParser: false, responseLimit: false } };

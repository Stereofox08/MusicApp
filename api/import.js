// POST /api/import
// Получает список файлов из R2 и сохраняет метаданные в Supabase
import { setCors } from './_sc.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const R2_ACCOUNT = process.env.R2_ACCOUNT_ID;
    const R2_BUCKET  = process.env.R2_BUCKET_NAME;
    const R2_PUBLIC  = process.env.R2_PUBLIC_URL;
    const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
    const SB_URL = process.env.SUPABASE_URL;
    const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

    // Получаем список файлов из R2 через S3 API
    const listUrl = await signedListUrl({ R2_ACCOUNT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY });
    const xmlRes  = await fetch(listUrl);
    const xml     = await xmlRes.text();

    // Парсим XML ответ от R2
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map(m => m[1])
      .filter(k => k.match(/\.(mp3|flac|ogg|wav|m4a|aac)$/i))
      // Пропускаем обложки
      .filter(k => !k.startsWith('art_'));

    if (keys.length === 0) return res.json({ imported: 0, message: 'No audio files found in R2' });

    // Получаем уже существующие файлы из Supabase чтобы не дублировать
    const existing = await fetch(`${SB_URL}/rest/v1/tracks?select=file_name`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    }).then(r => r.json());
    const existingNames = new Set((existing || []).map(t => t.file_name));

    const toImport = keys.filter(k => !existingNames.has(k));
    if (toImport.length === 0) return res.json({ imported: 0, message: 'All files already in library' });

    // Сохраняем каждый файл в Supabase
    let imported = 0;
    const tracks = toImport.map(key => {
      const fileName = key.replace(/^.*[\\/]/, '') // убираем путь
      const name     = fileName.replace(/\.[^.]+$/, '')
      const parts    = name.split(' - ')
      const title    = parts.length >= 2 ? parts.slice(1).join(' - ') : name
      const artist   = parts.length >= 2 ? parts[0] : 'Unknown'

      // Ищем обложку — файл art_ с похожим именем
      const artKey = `art_${key.replace(/\.[^.]+$/, '.jpg').replace(/^\d+_/, '')}`

      return {
        title,
        artist,
        file_url:  `${R2_PUBLIC}/${key}`,
        file_name: key,
        source:    'upload',
      }
    });

    // Вставляем пачками по 50
    for (let i = 0; i < tracks.length; i += 50) {
      const batch = tracks.slice(i, i + 50);
      const insertRes = await fetch(`${SB_URL}/rest/v1/tracks`, {
        method:  'POST',
        headers: {
          'apikey':        SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (insertRes.ok) imported += batch.length;
    }

    res.json({ imported, total: keys.length, message: `Imported ${imported} tracks` });
  } catch (e) {
    console.error('[import]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// Подписываем URL для получения списка объектов R2
async function signedListUrl({ R2_ACCOUNT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY }) {
  const region  = 'auto';
  const service = 's3';
  const host    = `${R2_ACCOUNT}.r2.cloudflarestorage.com`;
  const now     = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate   = now.toISOString().replace(/[:-]|\.\d+/g, '').slice(0, 15) + 'Z';
  const scope     = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${scope}`;

  const params = new URLSearchParams({
    'list-type':           '2',
    'max-keys':            '1000',
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    credential,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       '60',
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalRequest = [
    'GET',
    `/${R2_BUCKET}`,
    params.toString(),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const enc = new TextEncoder();
  const sha = async (data) => {
    const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };
  const hmac = async (key, msg) => {
    const k   = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
    return new Uint8Array(sig);
  };

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha(canonicalRequest)].join('\n');
  let sigKey = enc.encode(`AWS4${R2_SECRET_ACCESS_KEY}`);
  sigKey = await hmac(sigKey, dateStamp);
  sigKey = await hmac(sigKey, region);
  sigKey = await hmac(sigKey, service);
  sigKey = await hmac(sigKey, 'aws4_request');
  const signature = Array.from(await hmac(sigKey, stringToSign)).map(b => b.toString(16).padStart(2, '0')).join('');

  params.append('X-Amz-Signature', signature);
  return `https://${host}/${R2_BUCKET}?${params.toString()}`;
}

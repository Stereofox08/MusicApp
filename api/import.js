// POST /api/import
import { setCors } from './_sc.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const R2_ACCOUNT           = process.env.R2_ACCOUNT_ID;
    const R2_BUCKET            = process.env.R2_BUCKET_NAME;
    const R2_PUBLIC            = process.env.R2_PUBLIC_URL;
    const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
    const SB_URL               = process.env.SUPABASE_URL;
    const SB_KEY               = process.env.SUPABASE_SERVICE_KEY;

    const keys = await listR2Files({ R2_ACCOUNT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY });
    console.log('[import] total keys from R2:', keys.length);

    const audioKeys = keys.filter(k =>
      /\.(mp3|flac|ogg|wav|m4a|aac)$/i.test(k) && !k.startsWith('art_')
    );
    console.log('[import] audio keys:', audioKeys.length);

    if (audioKeys.length === 0) return res.json({ imported: 0, message: 'No audio files found in R2' });

    const existing = await fetch(`${SB_URL}/rest/v1/tracks?select=file_name&limit=1000`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    }).then(r => r.json());
    const existingNames = new Set((existing || []).map(t => t.file_name));

    const toImport = audioKeys.filter(k => !existingNames.has(k));
    console.log('[import] to import:', toImport.length);

    if (toImport.length === 0) return res.json({ imported: 0, message: 'All files already in library' });

    const tracks = toImport.map(key => {
      const name   = key.replace(/\.[^.]+$/, '').replace(/^\d+_/, '')
      const parts  = name.split(' - ')
      const title  = parts.length >= 2 ? parts.slice(1).join(' - ') : name
      const artist = parts.length >= 2 ? parts[0] : 'Unknown'
      return { title, artist, file_url: `${R2_PUBLIC}/${key}`, file_name: key, source: 'upload' }
    });

    let imported = 0;
    for (let i = 0; i < tracks.length; i += 50) {
      const batch = tracks.slice(i, i + 50);
      const r = await fetch(`${SB_URL}/rest/v1/tracks`, {
        method:  'POST',
        headers: {
          'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (r.ok) imported += batch.length;
      else console.error('[import] batch error:', await r.text());
    }

    res.json({ imported, total: audioKeys.length, message: `Импортировано ${imported} из ${audioKeys.length} треков` });
  } catch (e) {
    console.error('[import] error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

async function listR2Files({ R2_ACCOUNT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY }) {
  const enc     = new TextEncoder();
  const region  = 'auto';
  const service = 's3';
  const host    = `${R2_ACCOUNT}.r2.cloudflarestorage.com`;
  const now     = new Date();
  const ds      = now.toISOString().slice(0,10).replace(/-/g,'');
  const dt      = now.toISOString().replace(/[:-]|\.\d+/g,'').slice(0,15)+'Z';
  const scope   = `${ds}/${region}/${service}/aws4_request`;

  const sha256 = async (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
      .map(x => x.toString(16).padStart(2,'0')).join('');
  };
  const hmac = async (key, msg) => {
    const k = await crypto.subtle.importKey('raw', key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  };

  const query     = `list-type=2&max-keys=1000`;
  const canonical = `GET\n/${R2_BUCKET}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sts       = `AWS4-HMAC-SHA256\n${dt}\n${scope}\n${await sha256(canonical)}`;
  let sigKey      = enc.encode(`AWS4${R2_SECRET_ACCESS_KEY}`);
  sigKey = await hmac(sigKey, ds);
  sigKey = await hmac(sigKey, region);
  sigKey = await hmac(sigKey, service);
  sigKey = await hmac(sigKey, 'aws4_request');
  const sig  = Array.from(await hmac(sigKey, sts)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const auth = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope},SignedHeaders=host,Signature=${sig}`;
  const url  = `https://${host}/${R2_BUCKET}?${query}`;

  const r   = await fetch(url, { headers: { 'Authorization': auth, 'x-amz-date': dt, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' } });
  const xml = await r.text();
  console.log('[import] R2 list status:', r.status, xml.slice(0, 300));

  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
}

export const config = { api: { responseLimit: false } };

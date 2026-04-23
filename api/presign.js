// POST /api/presign
// Тело: { fileName, contentType }
// Возвращает: { uploadUrl, fileUrl, key }
// uploadUrl — presigned URL, браузер делает PUT без Authorization заголовка

import { setCors } from './_sc.js';

// Простая реализация AWS Signature V4 для R2
async function sign(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return new Uint8Array(sig);
}

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return toHex(new Uint8Array(buf));
}

async function getPresignedUrl({ accountId, bucket, key, contentType, accessKeyId, secretAccessKey, expiresIn = 3600 }) {
  const region   = 'auto';
  const service  = 's3';
  const host     = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${bucket}/${key}`;

  const now        = new Date();
  const dateStamp  = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate    = now.toISOString().replace(/[:-]|\.\d+/g, '').slice(0, 15) + 'Z';
  const scope      = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${scope}`;

  const params = new URLSearchParams({
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    credential,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'content-type;host',
  });

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    params.toString(),
    `content-type:${contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256hex(canonicalRequest),
  ].join('\n');

  const enc = new TextEncoder();
  let sigKey = enc.encode(`AWS4${secretAccessKey}`);
  sigKey = await sign(sigKey, dateStamp);
  sigKey = await sign(sigKey, region);
  sigKey = await sign(sigKey, service);
  sigKey = await sign(sigKey, 'aws4_request');
  const signature = toHex(await sign(sigKey, stringToSign));

  params.append('X-Amz-Signature', signature);
  return `${endpoint}?${params.toString()}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { fileName, contentType } = req.body;
    if (!fileName || !contentType) return res.status(400).json({ error: 'fileName and contentType required' });

    const R2_ACCOUNT          = process.env.R2_ACCOUNT_ID;
    const R2_BUCKET           = process.env.R2_BUCKET_NAME;
    const R2_PUBLIC           = process.env.R2_PUBLIC_URL;
    const R2_ACCESS_KEY_ID    = process.env.R2_ACCESS_KEY_ID;
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

    if (!R2_ACCOUNT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      return res.status(500).json({ error: 'R2 env vars missing. Need R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY' });
    }

    const key       = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploadUrl = await getPresignedUrl({
      accountId:       R2_ACCOUNT,
      bucket:          R2_BUCKET,
      key,
      contentType,
      accessKeyId:     R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    });
    const fileUrl = `${R2_PUBLIC}/${key}`;

    res.json({ uploadUrl, fileUrl, key });
  } catch (e) {
    console.error('[presign]', e.message);
    res.status(500).json({ error: e.message });
  }
}

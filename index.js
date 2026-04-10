require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const b2 = new S3Client({
  endpoint: `https://${process.env.B2_ENDPOINT}`,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

// ФИX #1: добавлен ACL public-read чтобы файлы были публично доступны
async function b2Upload(buffer, fileName, contentType) {
  await b2.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read',
  }));
  return `${process.env.B2_PUBLIC_URL}/${fileName}`;
}

async function b2Delete(fileName) {
  try {
    await b2.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: fileName }));
  } catch (e) {}
}

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files allowed'));
  }
});

// ─────────────────────────────────────────────
// SOUNDCLOUD — автоматическое получение client_id
// ─────────────────────────────────────────────

let SC_CLIENT_ID = process.env.SC_CLIENT_ID || null;
let SC_CLIENT_ID_FETCHED_AT = 0;
const SC_CLIENT_ID_TTL = 1000 * 60 * 60 * 6;

async function fetchSCClientId() {
  try {
    const homeRes = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
    });
    const html = await homeRes.text();
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
      .map(m => m[1]);
    for (const url of scriptUrls.reverse().slice(0, 5)) {
      const jsRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
      });
      const js = await jsRes.text();
      const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);
      if (match) {
        console.log('[SC] Got client_id: ' + match[1].substring(0, 8) + '...');
        return match[1];
      }
    }
    throw new Error('client_id not found in any bundle');
  } catch (err) {
    console.error('[SC] fetchSCClientId error:', err.message);
    return null;
  }
}

async function getSCClientId() {
  const now = Date.now();
  if (SC_CLIENT_ID && (now - SC_CLIENT_ID_FETCHED_AT) < SC_CLIENT_ID_TTL) return SC_CLIENT_ID;
  console.log('[SC] Refreshing client_id...');
  const id = await fetchSCClientId();
  if (id) { SC_CLIENT_ID = id; SC_CLIENT_ID_FETCHED_AT = now; }
  return SC_CLIENT_ID;
}

async function scFetch(path, params = {}) {
  const clientId = await getSCClientId();
  if (!clientId) throw new Error('SoundCloud client_id unavailable');
  const url = new URL('https://api-v2.soundcloud.com' + path);
  url.searchParams.set('client_id', clientId);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Origin': 'https://soundcloud.com',
      'Referer': 'https://soundcloud.com/',
    }
  });
  if (!res.ok) throw new Error('SoundCloud API ' + res.status + ': ' + await res.text());
  return res.json();
}

function formatSCTrack(track) {
  const transcodings = track.media?.transcodings || [];
  const progressive = transcodings.find(t => t.format?.protocol === 'progressive');
  const hls = transcodings.find(t => t.format?.protocol === 'hls');
  const streamUrl = progressive?.url || hls?.url || null;
  const artwork = (track.artwork_url || track.user?.avatar_url || null)
    ?.replace('-large', '-t300x300');
  return {
    id: 'sc_' + track.id,
    sc_id: track.id,
    title: track.title,
    artist: track.user?.username || 'Unknown',
    duration: Math.floor((track.duration || 0) / 1000),
    artwork,
    stream_url: streamUrl,
    source: 'soundcloud',
    permalink_url: track.permalink_url,
  };
}

// FIX #3: резолвим URL прямо перед использованием — SC ссылки живут ~1 мин
async function resolveSCStreamUrl(transcoding_url) {
  const clientId = await getSCClientId();
  const url = new URL(transcoding_url);
  url.searchParams.set('client_id', clientId);
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Origin': 'https://soundcloud.com',
      'Referer': 'https://soundcloud.com/',
    }
  });
  if (!res.ok) throw new Error('SC stream resolve ' + res.status);
  const data = await res.json();
  return data.url;
}

// ─────────────────────────────────────────────
// TRACKS
// ─────────────────────────────────────────────

app.get('/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/tracks/upload', upload.single('file'), async (req, res) => {
  try {
    const { title, artist } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const fileName = Date.now() + '_' + file.originalname.replace(/\s+/g, '_');
    console.log('[/upload] ' + fileName + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)');
    const fileUrl = await b2Upload(file.buffer, fileName, file.mimetype);
    console.log('[/upload] B2 url: ' + fileUrl);
    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: title || file.originalname.replace(/\.[^.]+$/, ''),
        artist: artist || 'Unknown',
        file_url: fileUrl,
        file_name: fileName,
        source: 'upload'
      })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });
    res.json(track);
  } catch (err) {
    console.error('[/upload] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/tracks/:id', async (req, res) => {
  const { id } = req.params;
  const { data: track } = await supabase
    .from('tracks').select('file_name').eq('id', id).single();
  if (track?.file_name) await b2Delete(track.file_name);
  const { error } = await supabase.from('tracks').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SEARCH — через SoundCloud
// ─────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const data = await scFetch('/search/tracks', { q, limit: 20, filter: 'streamable' });
    const tracks = (data.collection || [])
      .filter(t => t.streamable && t.media?.transcodings?.length > 0)
      .map(formatSCTrack)
      .filter(t => t.stream_url);
    console.log('[/search] Found ' + tracks.length + ' for "' + q + '"');
    res.json(tracks);
  } catch (err) {
    console.error('[/search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM — FIX #2: поддержка Range для перемотки
// ─────────────────────────────────────────────

// HLS стримим целиком (перемотка внутри HLS не нужна — браузер и так получит всё)
async function streamHLS(m3u8Url, res) {
  const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const playlistRes = await fetch(m3u8Url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://soundcloud.com/' }
  });
  if (!playlistRes.ok) throw new Error('HLS playlist HTTP ' + playlistRes.status);
  const playlist = await playlistRes.text();
  const segments = playlist.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (segments.length === 0) throw new Error('No HLS segments');
  console.log('[/stream] HLS: ' + segments.length + ' segments');

  // Сначала собираем весь буфер чтобы знать размер — это позволяет перемотку
  const chunks = [];
  for (const seg of segments) {
    const segUrl = seg.startsWith('http') ? seg : base + seg;
    try {
      const segRes = await fetch(segUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (segRes.ok) chunks.push(Buffer.from(await segRes.arrayBuffer()));
    } catch (e) {}
  }
  const fullBuffer = Buffer.concat(chunks);
  console.log('[/stream] HLS assembled: ' + (fullBuffer.length / 1024 / 1024).toFixed(1) + ' MB');
  return fullBuffer;
}

app.get('/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const decoded = decodeURIComponent(url);
    // Резолвим прямо сейчас — SC ссылки живут ~1 мин
    const realUrl = await resolveSCStreamUrl(decoded);
    const isHLS = realUrl.includes('.m3u8');
    console.log('[/stream] ' + (isHLS ? 'HLS' : 'MP3') + ': resolved OK');

    if (isHLS) {
      // HLS: собираем буфер и отдаём с Range поддержкой
      const fullBuffer = await streamHLS(realUrl, res);
      const total = fullBuffer.length;
      const rangeHeader = req.headers['range'];

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');

      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : total - 1;
        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', chunkSize);
        res.end(fullBuffer.slice(start, end + 1));
      } else {
        res.setHeader('Content-Length', total);
        res.end(fullBuffer);
      }
    } else {
      // Progressive MP3: форвардим с поддержкой Range
      const rangeHeader = req.headers['range'];
      const upstreamRes = await fetch(realUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://soundcloud.com/',
          ...(rangeHeader ? { 'Range': rangeHeader } : {}),
        }
      });
      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        throw new Error('Upstream HTTP ' + upstreamRes.status);
      }
      res.status(upstreamRes.status);
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      if (upstreamRes.headers.get('content-length')) {
        res.setHeader('Content-Length', upstreamRes.headers.get('content-length'));
      }
      if (upstreamRes.headers.get('content-range')) {
        res.setHeader('Content-Range', upstreamRes.headers.get('content-range'));
      }
      upstreamRes.body.pipe(res);
    }
  } catch (err) {
    console.error('[/stream] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ─────────────────────────────────────────────
// DOWNLOAD — скачать трек с SoundCloud → B2
// ─────────────────────────────────────────────

async function downloadHLSToBuffer(m3u8Url) {
  const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const playlistRes = await fetch(m3u8Url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!playlistRes.ok) throw new Error('HLS playlist HTTP ' + playlistRes.status);
  const playlist = await playlistRes.text();
  const segments = playlist.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const chunks = [];
  for (const seg of segments) {
    const segUrl = seg.startsWith('http') ? seg : base + seg;
    const segRes = await fetch(segUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (segRes.ok) chunks.push(Buffer.from(await segRes.arrayBuffer()));
  }
  return Buffer.concat(chunks);
}

app.post('/download', async (req, res) => {
  const { sc_id, stream_url, title, artist } = req.body;
  if (!stream_url) return res.status(400).json({ error: 'stream_url required' });
  try {
    console.log('[/download] Starting: ' + title);

    // FIX #3: резолвим URL прямо сейчас — он мог протухнуть пока пользователь думал
    const decoded = decodeURIComponent(stream_url);
    const realUrl = await resolveSCStreamUrl(decoded);
    console.log('[/download] Resolved stream URL OK');

    const isHLS = realUrl.includes('.m3u8');
    let fileBuffer;
    if (isHLS) {
      console.log('[/download] HLS mode');
      fileBuffer = await downloadHLSToBuffer(realUrl);
    } else {
      const audioRes = await fetch(realUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://soundcloud.com/' }
      });
      if (!audioRes.ok) throw new Error('Download HTTP ' + audioRes.status);
      fileBuffer = Buffer.from(await audioRes.arrayBuffer());
    }
    console.log('[/download] Downloaded: ' + (fileBuffer.length / 1024 / 1024).toFixed(1) + ' MB');

    const fileName = 'sc_' + (sc_id || Date.now()) + '_' + Date.now() + '.mp3';
    const fileUrl = await b2Upload(fileBuffer, fileName, 'audio/mpeg');
    console.log('[/download] B2 url: ' + fileUrl);

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: title || 'Unknown',
        artist: artist || 'Unknown',
        file_url: fileUrl,
        file_name: fileName,
        source: 'sc_saved',
      })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });
    console.log('[/download] Saved to library: ' + fileName);
    res.json(track);
  } catch (err) {
    console.error('[/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────
// PROXY — оффлайн треки из B2 через бэкенд (решает CORS + Range)
// ─────────────────────────────────────────────

app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const decoded = decodeURIComponent(url);

  // Разрешаем только наш B2 bucket — защита от открытого прокси
  const allowedHost = (process.env.B2_PUBLIC_URL || '').replace(/\/$/, '');
  if (allowedHost && !decoded.startsWith(allowedHost)) {
    console.error('[/proxy] Blocked URL: ' + decoded.substring(0, 60));
    return res.status(403).json({ error: 'URL not allowed' });
  }

  try {
    const rangeHeader = req.headers['range'];
    console.log('[/proxy] ' + (rangeHeader ? 'Range: ' + rangeHeader + ' | ' : '') + decoded.substring(0, 60) + '...');

    const b2Res = await fetch(decoded, {
      headers: rangeHeader ? { 'Range': rangeHeader } : {}
    });

    if (!b2Res.ok && b2Res.status !== 206) {
      console.error('[/proxy] B2 returned ' + b2Res.status + ' for: ' + decoded);
      return res.status(b2Res.status).json({ error: 'B2 returned HTTP ' + b2Res.status });
    }

    res.status(b2Res.status);
    res.setHeader('Content-Type', b2Res.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    if (b2Res.headers.get('content-length')) res.setHeader('Content-Length', b2Res.headers.get('content-length'));
    if (b2Res.headers.get('content-range')) res.setHeader('Content-Range', b2Res.headers.get('content-range'));
    b2Res.body.pipe(res);
  } catch (err) {
    console.error('[/proxy] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'soundcloud' }));

getSCClientId().then(id => {
  if (id) console.log('[SC] client_id ready');
  else console.warn('[SC] WARNING: could not get client_id on startup');
});

app.listen(PORT, () => console.log('MusicApp backend running on port ' + PORT));

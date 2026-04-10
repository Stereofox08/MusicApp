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

async function b2Upload(buffer, fileName, contentType) {
  await b2.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
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
// VK Audio API
// ─────────────────────────────────────────────

const VK_TOKEN = process.env.VK_TOKEN;
const VK_API = 'https://api.vk.com/method';
const VK_VERSION = '5.131';

async function vkCall(method, params = {}) {
  const url = new URL(`${VK_API}/${method}`);
  url.searchParams.set('access_token', VK_TOKEN);
  url.searchParams.set('v', VK_VERSION);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'VKAndroidApp/7.14-12584 (Android 12; SDK 32; arm64-v8a; samsung SM-G998B; ru)' }
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.error_msg || 'VK API error');
  return data.response;
}

function formatTrack(audio) {
  return {
    id: `vk_${audio.owner_id}_${audio.id}`,
    vk_id: `${audio.owner_id}_${audio.id}`,
    title: audio.title,
    artist: audio.artist,
    duration: audio.duration || 0,
    artwork: audio.album?.thumb?.photo_300 || null,
    stream_url: audio.url || null,
    source: 'vk',
  };
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

    const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
    console.log(`[/upload] ${fileName} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    const fileUrl = await b2Upload(file.buffer, fileName, file.mimetype);
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
// SEARCH — через VK Audio
// ─────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const response = await vkCall('audio.search', {
      q,
      count: 20,
      sort: 0,
    });
    const items = response.items || [];
    // Диагностика: логируем первые 3 трека чтобы видеть структуру url
    items.slice(0, 3).forEach((a, i) => {
      const urlPreview = a.url ? a.url.substring(0, 80) : 'EMPTY';
      const isHLS = a.url && a.url.includes('.m3u8');
      console.log(`[/search] [${i}] "${a.artist} - ${a.title}" | url: ${urlPreview}... | HLS: ${isHLS}`);
    });
    const tracks = items
      .filter(a => a.url)
      .map(formatTrack);
    console.log(`[/search] Found ${tracks.length}/${items.length} with url for "${q}"`);
    res.json(tracks);
  } catch (err) {
    console.error('[/search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM — проксируем аудио с VK (mp3 + HLS m3u8)
// ─────────────────────────────────────────────

const VK_HEADERS = {
  'User-Agent': 'VKAndroidApp/7.14-12584 (Android 12; SDK 32; arm64-v8a; samsung SM-G998B; ru)',
  'Referer': 'https://vk.com/',
};

// Скачать HLS плейлист и собрать все .ts сегменты в один поток
async function streamHLS(m3u8Url, res) {
  const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const playlistRes = await fetch(m3u8Url, { headers: VK_HEADERS });
  if (!playlistRes.ok) throw new Error(`HLS playlist HTTP ${playlistRes.status}`);
  const playlist = await playlistRes.text();

  // Извлекаем .ts сегменты
  const segments = playlist.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (segments.length === 0) throw new Error('No HLS segments found');

  console.log(`[/stream] HLS: ${segments.length} segments`);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Transfer-Encoding', 'chunked');

  for (const seg of segments) {
    const segUrl = seg.startsWith('http') ? seg : base + seg;
    try {
      const segRes = await fetch(segUrl, { headers: VK_HEADERS });
      if (!segRes.ok) continue;
      const buf = Buffer.from(await segRes.arrayBuffer());
      res.write(buf);
    } catch (e) {
      console.warn(`[/stream] Segment error: ${e.message}`);
    }
  }
  res.end();
}

app.get('/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const decoded = decodeURIComponent(url);
  try {
    const isHLS = decoded.includes('.m3u8');
    console.log(`[/stream] ${isHLS ? 'HLS' : 'MP3'}: ${decoded.substring(0, 60)}...`);

    if (isHLS) {
      await streamHLS(decoded, res);
    } else {
      const audioRes = await fetch(decoded, { headers: VK_HEADERS });
      if (!audioRes.ok) throw new Error(`Upstream HTTP ${audioRes.status}`);
      res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (audioRes.headers.get('content-length')) {
        res.setHeader('Content-Length', audioRes.headers.get('content-length'));
      }
      audioRes.body.pipe(res);
    }
  } catch (err) {
    console.error('[/stream] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ─────────────────────────────────────────────
// DOWNLOAD — скачать трек с VK → B2
// ─────────────────────────────────────────────

async function downloadHLSToBuffer(m3u8Url) {
  const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const playlistRes = await fetch(m3u8Url, { headers: VK_HEADERS });
  if (!playlistRes.ok) throw new Error(`HLS playlist HTTP ${playlistRes.status}`);
  const playlist = await playlistRes.text();
  const segments = playlist.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const chunks = [];
  for (const seg of segments) {
    const segUrl = seg.startsWith('http') ? seg : base + seg;
    const segRes = await fetch(segUrl, { headers: VK_HEADERS });
    if (segRes.ok) chunks.push(Buffer.from(await segRes.arrayBuffer()));
  }
  return Buffer.concat(chunks);
}

app.post('/download', async (req, res) => {
  const { vk_id, stream_url, title, artist } = req.body;
  if (!stream_url) return res.status(400).json({ error: 'stream_url required' });
  try {
    console.log(`[/download] Starting: ${title}`);
    const decoded = decodeURIComponent(stream_url);
    const isHLS = decoded.includes('.m3u8');

    let fileBuffer;
    if (isHLS) {
      console.log(`[/download] HLS mode`);
      fileBuffer = await downloadHLSToBuffer(decoded);
    } else {
      const audioRes = await fetch(decoded, { headers: VK_HEADERS });
      if (!audioRes.ok) throw new Error(`Download HTTP ${audioRes.status}`);
      fileBuffer = Buffer.from(await audioRes.arrayBuffer());
    }
    console.log(`[/download] Downloaded: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

    const fileName = `vk_${vk_id}_${Date.now()}.mp3`;
    const fileUrl = await b2Upload(fileBuffer, fileName, 'audio/mpeg');

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: title || 'Unknown',
        artist: artist || 'Unknown',
        file_url: fileUrl,
        file_name: fileName,
        source: 'vk_saved',
      })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });

    console.log(`[/download] Saved: ${fileName}`);
    res.json(track);
  } catch (err) {
    console.error('[/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'vk' }));

app.listen(PORT, () => console.log(`MusicApp backend running on port ${PORT}`));

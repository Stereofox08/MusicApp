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
      sort: 0, // по популярности
    });
    const tracks = (response.items || [])
      .filter(a => a.url) // только треки с доступной ссылкой
      .map(formatTrack);
    console.log(`[/search] Found ${tracks.length} for "${q}"`);
    res.json(tracks);
  } catch (err) {
    console.error('[/search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM — проксируем аудио с VK
// ─────────────────────────────────────────────

app.get('/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const audioRes = await fetch(decodeURIComponent(url), {
      headers: {
        'User-Agent': 'VKAndroidApp/7.14-12584 (Android 12; SDK 32; arm64-v8a; samsung SM-G998B; ru)',
        'Referer': 'https://vk.com/',
      }
    });
    if (!audioRes.ok) throw new Error(`Upstream HTTP ${audioRes.status}`);
    res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (audioRes.headers.get('content-length')) {
      res.setHeader('Content-Length', audioRes.headers.get('content-length'));
    }
    audioRes.body.pipe(res);
  } catch (err) {
    console.error('[/stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOWNLOAD — скачать трек с VK → B2
// ─────────────────────────────────────────────

app.post('/download', async (req, res) => {
  const { vk_id, stream_url, title, artist } = req.body;
  if (!stream_url) return res.status(400).json({ error: 'stream_url required' });
  try {
    console.log(`[/download] Starting: ${title}`);
    const audioRes = await fetch(decodeURIComponent(stream_url), {
      headers: {
        'User-Agent': 'VKAndroidApp/7.14-12584',
        'Referer': 'https://vk.com/',
      }
    });
    if (!audioRes.ok) throw new Error(`Download HTTP ${audioRes.status}`);

    const fileBuffer = Buffer.from(await audioRes.arrayBuffer());
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

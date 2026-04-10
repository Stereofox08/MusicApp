require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const execFileAsync = promisify(execFile);

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

const B2_BUCKET = process.env.B2_BUCKET_NAME;
const B2_PUBLIC_URL = process.env.B2_PUBLIC_URL;

async function b2Upload(buffer, fileName, contentType) {
  await b2.send(new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${B2_PUBLIC_URL}/${fileName}`;
}

async function b2Delete(fileName) {
  try {
    await b2.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: fileName }));
  } catch (e) { /* ignore */ }
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
// Invidious — список публичных серверов
// Если один не работает, пробуем следующий
// ─────────────────────────────────────────────

const INVIDIOUS_INSTANCES = [
  'https://iv.datura.network',
  'https://invidious.privacydev.net',
  'https://yt.cdaut.de',
  'https://invidious.nerdvpn.de',
  'https://inv.tux.pizza',
];

async function invidiousFetch(path, retries = 3) {
  for (let i = 0; i < INVIDIOUS_INSTANCES.length && retries > 0; i++) {
    try {
      const res = await fetch(`${INVIDIOUS_INSTANCES[i]}${path}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.ok) return res;
      retries--;
    } catch (e) {
      retries--;
    }
  }
  throw new Error('All Invidious instances failed');
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
    .from('tracks').select('file_name, source').eq('id', id).single();
  if (track?.file_name) await b2Delete(track.file_name);
  const { error } = await supabase.from('tracks').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SEARCH — через Invidious (без yt-dlp, без куки)
// ─────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const apiRes = await invidiousFetch(
      `/api/v1/search?q=${encodeURIComponent(q)}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails`
    );
    const data = await apiRes.json();

    const tracks = (data || []).slice(0, 20).map(item => ({
      id: `yt_${item.videoId}`,
      youtube_id: item.videoId,
      title: item.title,
      artist: item.author,
      duration: item.lengthSeconds || 0,
      artwork: item.videoThumbnails?.find(t => t.quality === 'medium')?.url
        || item.videoThumbnails?.[0]?.url || null,
      source: 'youtube',
    }));

    console.log(`[/search] Found ${tracks.length} for "${q}"`);
    res.json(tracks);
  } catch (err) {
    console.error('[/search] Error:', err.message);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM — через Invidious (без yt-dlp, без куки)
// ─────────────────────────────────────────────

app.get('/stream', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });
  try {
    // Получаем список аудио форматов через Invidious
    const apiRes = await invidiousFetch(`/api/v1/videos/${id}?fields=adaptiveFormats`);
    const data = await apiRes.json();

    // Берём лучший аудио формат
    const formats = (data.adaptiveFormats || [])
      .filter(f => f.type?.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (!formats.length) throw new Error('No audio formats found');

    const audioUrl = formats[0].url;
    if (!audioUrl) throw new Error('No audio URL');

    // Проксируем аудио
    const audioRes = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.youtube.com/',
      }
    });

    if (!audioRes.ok) throw new Error(`Upstream HTTP ${audioRes.status}`);

    res.setHeader('Content-Type', formats[0].type?.split(';')[0] || 'audio/webm');
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
// DOWNLOAD — через Invidious → B2
// ─────────────────────────────────────────────

app.post('/download', async (req, res) => {
  const { youtube_id, title, artist } = req.body;
  if (!youtube_id) return res.status(400).json({ error: 'youtube_id required' });
  try {
    console.log(`[/download] Starting: ${youtube_id}`);

    const apiRes = await invidiousFetch(`/api/v1/videos/${youtube_id}?fields=adaptiveFormats,title,author`);
    const data = await apiRes.json();

    const formats = (data.adaptiveFormats || [])
      .filter(f => f.type?.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (!formats.length) throw new Error('No audio formats found');

    const audioUrl = formats[0].url;
    const audioRes = await fetch(audioUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/' }
    });
    if (!audioRes.ok) throw new Error(`Download failed: HTTP ${audioRes.status}`);

    const fileBuffer = Buffer.from(await audioRes.arrayBuffer());
    console.log(`[/download] Downloaded: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

    const ext = formats[0].type?.includes('mp4') ? 'm4a' : 'webm';
    const fileName = `yt_${youtube_id}_${Date.now()}.${ext}`;
    const fileUrl = await b2Upload(fileBuffer, fileName, formats[0].type?.split(';')[0] || 'audio/webm');

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: title || data.title || `YouTube: ${youtube_id}`,
        artist: artist || data.author || 'Unknown',
        file_url: fileUrl,
        file_name: fileName,
        source: 'youtube_saved',
        youtube_id
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

app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'invidious' }));

app.listen(PORT, () => console.log(`MusicApp backend running on port ${PORT}`));

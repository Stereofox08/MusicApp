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
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files allowed'));
  }
});

// ─────────────────────────────────────────────
// yt-dlp config
// ─────────────────────────────────────────────

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const COOKIES_PATH = path.join('/tmp', 'cookies.txt');

// Записываем cookies из env в файл при старте
function setupCookies() {
  if (process.env.YOUTUBE_COOKIES) {
    fs.writeFileSync(COOKIES_PATH, process.env.YOUTUBE_COOKIES, 'utf8');
    console.log('[cookies] Written to', COOKIES_PATH, `(${process.env.YOUTUBE_COOKIES.length} bytes)`);
    return true;
  }
  console.warn('[cookies] YOUTUBE_COOKIES env not set! Streams may fail.');
  return false;
}

const hasCookies = setupCookies();

// Базовые аргументы для yt-dlp
function baseArgs() {
  const args = ['--no-warnings', '--quiet'];
  if (hasCookies) {
    args.push('--cookies', COOKIES_PATH);
  }
  return args;
}

// ─────────────────────────────────────────────
// yt-dlp helpers
// ─────────────────────────────────────────────

async function ytSearch(query, limit = 20) {
  const args = [
    `ytsearch${limit}:${query}`,
    '--dump-json',
    '--flat-playlist',
    ...baseArgs(),
  ];

  const { stdout } = await execFileAsync(YTDLP, args, {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const tracks = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      const duration = item.duration || 0;
      const thumbs = item.thumbnails || [];
      const thumbnail = thumbs.length
        ? thumbs[thumbs.length - 1].url
        : (item.thumbnail || null);

      tracks.push({
        id: `yt_${item.id}`,
        youtube_id: item.id,
        title: item.title || 'Unknown',
        artist: item.channel || item.uploader || 'Unknown',
        duration: Math.floor(duration),
        artwork: thumbnail,
        source: 'youtube',
      });
    } catch (e) { /* skip */ }
  }
  return tracks;
}

async function ytGetAudioUrl(videoId) {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', 'bestaudio',
    '--get-url',
    ...baseArgs(),
  ];

  const { stdout } = await execFileAsync(YTDLP, args, { timeout: 30000 });
  const url = stdout.trim().split('\n')[0];
  if (!url || !url.startsWith('http')) {
    throw new Error('Failed to extract audio URL');
  }
  return url;
}

async function ytGetStreamInfo(videoId) {
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', 'bestaudio',
    '--dump-json',
    ...baseArgs(),
  ];

  const { stdout } = await execFileAsync(YTDLP, args, {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function ytDownloadBuffer(videoId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      '-f', 'bestaudio',
      '-o', '-',
      ...baseArgs(),
    ];

    const proc = spawn(YTDLP, args, { timeout: 120000 });

    proc.stdout.on('data', chunk => chunks.push(chunk));

    let stderrData = '';
    proc.stderr.on('data', d => { stderrData += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderrData.slice(0, 500)}`));
      }
      resolve(Buffer.concat(chunks));
    });
    proc.on('error', reject);
  });
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
    const { error: storageError } = await supabase.storage
      .from('tracks').upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
    if (storageError) return res.status(500).json({ error: storageError.message });

    const { data: urlData } = supabase.storage.from('tracks').getPublicUrl(fileName);
    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: title || file.originalname,
        artist: artist || 'Unknown',
        file_url: urlData.publicUrl,
        file_name: fileName,
        source: 'upload'
      })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });
    res.json(track);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/tracks/:id', async (req, res) => {
  const { id } = req.params;
  const { data: track } = await supabase
    .from('tracks').select('file_name, source').eq('id', id).single();
  if (track && ['upload', 'youtube_saved'].includes(track.source) && track.file_name) {
    await supabase.storage.from('tracks').remove([track.file_name]);
  }
  const { error } = await supabase.from('tracks').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const tracks = await ytSearch(q, 20);
    console.log(`[/search] Found ${tracks.length} results for "${q}"`);
    res.json(tracks);
  } catch (err) {
    console.error('[/search] Error:', err.message);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM
// ─────────────────────────────────────────────

app.get('/stream', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });

  try {
    const audioUrl = await ytGetAudioUrl(id);
    console.log(`[/stream] Proxying ${id}`);

    const audioRes = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
      }
    });

    if (!audioRes.ok) throw new Error(`Upstream HTTP ${audioRes.status}`);

    res.setHeader('Content-Type', 'audio/mp4');
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
// DOWNLOAD
// ─────────────────────────────────────────────

app.post('/download', async (req, res) => {
  const { youtube_id, title, artist } = req.body;
  if (!youtube_id) return res.status(400).json({ error: 'youtube_id required' });

  try {
    console.log(`[/download] Starting download: ${youtube_id}`);

    let meta = {};
    try {
      meta = await ytGetStreamInfo(youtube_id);
    } catch (e) {
      console.warn('[/download] Could not get metadata:', e.message);
    }

    const fileBuffer = await ytDownloadBuffer(youtube_id);
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    console.log(`[/download] Downloaded ${youtube_id}: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

    const ext = (meta.ext === 'webm') ? 'webm' : 'm4a';
    const contentType = ext === 'webm' ? 'audio/webm' : 'audio/mp4';
    const fileName = `yt_${youtube_id}_${Date.now()}.${ext}`;

    const { error: storageError } = await supabase.storage
      .from('tracks').upload(fileName, fileBuffer, { contentType, upsert: false });
    if (storageError) return res.status(500).json({ error: storageError.message });

    const { data: urlData } = supabase.storage.from('tracks').getPublicUrl(fileName);
    const trackTitle = title || meta.title || `YouTube: ${youtube_id}`;
    const trackArtist = artist || meta.channel || meta.uploader || 'Unknown';

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({
        title: trackTitle,
        artist: trackArtist,
        file_url: urlData.publicUrl,
        file_name: fileName,
        source: 'youtube_saved',
        youtube_id
      })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });

    console.log(`[/download] Saved ${youtube_id} as ${fileName}`);
    res.json(track);
  } catch (err) {
    console.error('[/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/health', async (req, res) => {
  let ytdlpVersion = 'unknown';
  try {
    const { stdout } = await execFileAsync(YTDLP, ['--version'], { timeout: 5000 });
    ytdlpVersion = stdout.trim();
  } catch (e) {
    ytdlpVersion = 'not found: ' + e.message;
  }
  res.json({
    status: 'ok',
    mode: 'yt-dlp',
    ytdlpVersion,
    hasCookies,
  });
});

app.listen(PORT, () => {
  console.log(`MusicApp backend running on port ${PORT}`);
  console.log(`Cookies: ${hasCookies ? 'YES' : 'NO'}`);
});

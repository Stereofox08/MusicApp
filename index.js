require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

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
// Piped instances — fallback list
// ─────────────────────────────────────────────
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.coldforge.xyz',
  'https://pipedapi.aeong.one',
];

async function getPipedStreams(videoId) {
  const errors = [];
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': 'MusicApp/1.0' },
        timeout: 10000,
      });
      if (!res.ok) {
        errors.push(`${instance}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!data.audioStreams || data.audioStreams.length === 0) {
        errors.push(`${instance}: no audio streams`);
        continue;
      }
      console.log(`[Piped] Got streams from ${instance} for ${videoId}`);
      return data;
    } catch (err) {
      errors.push(`${instance}: ${err.message}`);
    }
  }
  throw new Error('All Piped instances failed: ' + errors.join(' | '));
}

function getBestAudioStream(audioStreams) {
  // Prefer m4a/mp4, then webm, sort by bitrate desc
  const sorted = [...audioStreams].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const m4a = sorted.find(s => s.mimeType && s.mimeType.includes('m4a'));
  const mp4 = sorted.find(s => s.mimeType && s.mimeType.includes('mp4'));
  return m4a || mp4 || sorted[0];
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
      .insert({ title: title || file.originalname, artist: artist || 'Unknown', file_url: urlData.publicUrl, file_name: fileName, source: 'upload' })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });
    res.json(track);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/tracks/:id', async (req, res) => {
  const { id } = req.params;
  const { data: track } = await supabase.from('tracks').select('file_name, source').eq('id', id).single();
  if (track && ['upload', 'youtube_saved'].includes(track.source) && track.file_name) {
    await supabase.storage.from('tracks').remove([track.file_name]);
  }
  const { error } = await supabase.from('tracks').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SEARCH — через youtube-search-python (python3 search.py)
// ─────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const escaped = q.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `python3 ${__dirname}/search.py "${escaped}"`,
      { timeout: 15000 }
    );
    const results = JSON.parse(stdout.trim());
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// STREAM — через Piped API (без yt-dlp, без 429)
// GET /stream?id=VIDEO_ID
// ─────────────────────────────────────────────

app.get('/stream', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });

  try {
    const pipedData = await getPipedStreams(id);
    const stream = getBestAudioStream(pipedData.audioStreams);
    if (!stream || !stream.url) throw new Error('No audio stream URL found');

    console.log(`[/stream] Proxying ${id} via ${stream.mimeType} ${stream.bitrate}bps`);

    // Проксируем через бэкенд чтобы обойти CORS на клиенте
    const audioRes = await fetch(stream.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    res.setHeader('Content-Type', stream.mimeType || 'audio/mp4');
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
// DOWNLOAD — скачиваем через Piped, сохраняем в Supabase
// POST /download  { youtube_id, title, artist }
// ─────────────────────────────────────────────

app.post('/download', async (req, res) => {
  const { youtube_id, title, artist } = req.body;
  if (!youtube_id) return res.status(400).json({ error: 'youtube_id required' });

  try {
    const pipedData = await getPipedStreams(youtube_id);
    const stream = getBestAudioStream(pipedData.audioStreams);
    if (!stream || !stream.url) throw new Error('No audio stream URL found');

    console.log(`[/download] Downloading ${youtube_id} via Piped`);

    const audioRes = await fetch(stream.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!audioRes.ok) throw new Error(`Failed to fetch audio: HTTP ${audioRes.status}`);

    const chunks = [];
    for await (const chunk of audioRes.body) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    const ext = (stream.mimeType || 'audio/mp4').includes('webm') ? 'webm' : 'm4a';
    const fileName = `yt_${youtube_id}_${Date.now()}.${ext}`;
    const contentType = stream.mimeType || 'audio/mp4';

    const { error: storageError } = await supabase.storage
      .from('tracks').upload(fileName, fileBuffer, { contentType, upsert: false });
    if (storageError) return res.status(500).json({ error: storageError.message });

    const { data: urlData } = supabase.storage.from('tracks').getPublicUrl(fileName);
    const trackTitle = title || pipedData.title || `YouTube: ${youtube_id}`;
    const trackArtist = artist || pipedData.uploader || 'Unknown';

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({ title: trackTitle, artist: trackArtist, file_url: urlData.publicUrl, file_name: fileName, source: 'youtube_saved', youtube_id })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });

    console.log(`[/download] Saved ${youtube_id} as ${fileName}`);
    res.json(track);
  } catch (err) {
    console.error('[/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'piped' }));

app.listen(PORT, () => console.log('MusicApp backend running on port ' + PORT));

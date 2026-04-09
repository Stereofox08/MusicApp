require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
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
// ПОИСК — через youtube-search-python (NO API KEY!)
// Установка: pip install youtube-search-python
// Скрипт search.py вызывается через exec
// ─────────────────────────────────────────────

// GET /search?q=...
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    // Вызываем питон-скрипт, он выводит JSON в stdout
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

// GET /stream?id=VIDEO_ID — прямая ссылка на аудио через yt-dlp (NO API KEY!)
// pip install yt-dlp
app.get('/stream', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });
  try {
    const { stdout } = await execAsync(
      `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio" --get-url --no-playlist --extractor-args "youtube:skip=dash" "https://www.youtube.com/watch?v=${id}"`,
      { timeout: 30000 }
    );
    const streamUrl = stdout.trim().split('\n')[0];
    if (!streamUrl) throw new Error('Could not get stream URL');

    // Проксируем аудио через бэкенд чтобы обойти CORS
    const fetch = require('node-fetch');
    const audioRes = await fetch(streamUrl);
    res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    audioRes.body.pipe(res);
  } catch (err) {
    console.error('[/stream] Error:', err.message, err.stderr || '');
    res.status(500).json({ error: 'yt-dlp failed: ' + err.message });
  }  { youtube_id, title, artist }
// Скачивает mp3 → Supabase Storage → добавляет в библиотеку
// pip install yt-dlp  +  apt install ffmpeg
app.post('/download', async (req, res) => {
  const { youtube_id, title, artist } = req.body;
  if (!youtube_id) return res.status(400).json({ error: 'youtube_id required' });
  try {
    const tmpFile = `/tmp/yt_${youtube_id}_${Date.now()}.mp3`;
    await execAsync(
      `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 --no-playlist --extractor-args "youtube:skip=dash" -o "${tmpFile}" "https://www.youtube.com/watch?v=${youtube_id}"`,
      { timeout: 180000 }
    );

    const fs = require('fs');
    const fileBuffer = fs.readFileSync(tmpFile);
    const fileName = `yt_${youtube_id}_${Date.now()}.mp3`;

    const { error: storageError } = await supabase.storage
      .from('tracks').upload(fileName, fileBuffer, { contentType: 'audio/mpeg', upsert: false });
    fs.unlinkSync(tmpFile);
    if (storageError) return res.status(500).json({ error: storageError.message });

    const { data: urlData } = supabase.storage.from('tracks').getPublicUrl(fileName);
    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .insert({ title: title || `YouTube: ${youtube_id}`, artist: artist || 'Unknown', file_url: urlData.publicUrl, file_name: fileName, source: 'youtube_saved', youtube_id })
      .select().single();
    if (dbError) return res.status(500).json({ error: dbError.message });
    res.json(track);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🎵 MusicApp backend running on port ${PORT}`));

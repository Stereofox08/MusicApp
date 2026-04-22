// GET /api/stream?url=<transcoding_url>
import { resolveStreamUrl, setCors } from './_sc.js';

async function assembleHLS(m3u8Url) {
  const base     = m3u8Url.slice(0, m3u8Url.lastIndexOf('/') + 1);
  const playlist = await fetch(m3u8Url).then(r => r.text());
  const segments = playlist.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const chunks   = await Promise.all(
    segments.map(seg => {
      const url = seg.startsWith('http') ? seg : base + seg;
      return fetch(url).then(r => r.arrayBuffer()).catch(() => new ArrayBuffer(0));
    })
  );
  const total  = chunks.reduce((s, c) => s + c.byteLength, 0);
  const result = new Uint8Array(total);
  let   offset = 0;
  for (const c of chunks) { result.set(new Uint8Array(c), offset); offset += c.byteLength; }
  return Buffer.from(result);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const realUrl = await resolveStreamUrl(decodeURIComponent(url));
    const isHLS   = realUrl.includes('.m3u8');

    if (isHLS) {
      const buf   = await assembleHLS(realUrl);
      const total = buf.length;
      const range = req.headers['range'];
      res.setHeader('Content-Type',  'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (range) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start  = parseInt(s, 10);
        const end    = e ? parseInt(e, 10) : total - 1;
        res.status(206);
        res.setHeader('Content-Range',  `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', end - start + 1);
        res.end(buf.slice(start, end + 1));
      } else {
        res.setHeader('Content-Length', total);
        res.end(buf);
      }
    } else {
      const range    = req.headers['range'];
      const upstream = await fetch(realUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer':    'https://soundcloud.com/',
          ...(range ? { Range: range } : {}),
        }
      });
      res.status(upstream.status);
      res.setHeader('Content-Type',  upstream.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range',  cr);
      const reader = upstream.body.getReader();
      const pump   = async () => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    }
  } catch (e) {
    console.error('[stream]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
}

export const config = { api: { responseLimit: false } };

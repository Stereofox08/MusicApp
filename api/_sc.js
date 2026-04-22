// api/_sc.js — SoundCloud helper (shared across API routes)

let _clientId  = null;
let _fetchedAt = 0;
const TTL      = 6 * 60 * 60 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
  'Origin':     'https://soundcloud.com',
  'Referer':    'https://soundcloud.com/',
};

export async function getClientId() {
  if (_clientId && Date.now() - _fetchedAt < TTL) return _clientId;
  const html    = await fetch('https://soundcloud.com', { headers: HEADERS }).then(r => r.text());
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map(m => m[1]).reverse().slice(0, 6);
  for (const url of scripts) {
    const js = await fetch(url, { headers: HEADERS }).then(r => r.text());
    const m  = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);
    if (m) { _clientId = m[1]; _fetchedAt = Date.now(); return _clientId; }
  }
  throw new Error('SC client_id not found');
}

export async function scFetch(path, params = {}) {
  const id  = await getClientId();
  const url = new URL('https://api-v2.soundcloud.com' + path);
  url.searchParams.set('client_id', id);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`SC ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function resolveStreamUrl(transcodingUrl) {
  const id  = await getClientId();
  const url = new URL(transcodingUrl);
  url.searchParams.set('client_id', id);
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) throw new Error(`SC resolve ${res.status}`);
  const { url: streamUrl } = await res.json();
  return streamUrl;
}

export function formatTrack(t) {
  const tc          = t.media?.transcodings || [];
  const progressive = tc.find(x => x.format?.protocol === 'progressive');
  const hls         = tc.find(x => x.format?.protocol === 'hls');
  const streamUrl   = (progressive || hls)?.url || null;
  const artwork     = (t.artwork_url || t.user?.avatar_url || null)
                        ?.replace('-large', '-t300x300');
  return {
    id:         t.id,
    title:      t.title,
    artist:     t.user?.username || 'Unknown',
    duration:   Math.floor((t.duration || 0) / 1000),
    artwork,
    stream_url: streamUrl,
    permalink:  t.permalink_url || null,
    source:     'soundcloud',
  };
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

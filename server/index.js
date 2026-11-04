import express from 'express';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import youtubedl from 'youtube-dl-exec';
import pg from 'pg';
import { Innertube } from 'youtubei.js';

const PORT = Number(process.env.PORT) || 3001;
const GROUP_KEY = process.env.GROUP_KEY || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[\w-]{11}$/;

// Render's IPs often get YouTube's "confirm you're not a bot" wall; exported cookies fix it.
// Several player clients: when YouTube challenges one (common on cloud IPs), yt-dlp falls back to the next.
const ytOpts = {
  extractorArgs: `youtube:player_client=${process.env.YTDLP_CLIENTS || 'default,tv,web_safari'}`,
};
if (process.env.YTDLP_COOKIES) {
  const file = path.join(process.env.TMPDIR || '/tmp', 'yt-cookies.txt');
  fs.writeFileSync(file, process.env.YTDLP_COOKIES);
  ytOpts.cookies = file;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// one line per API call: helps debug phones we can't attach a console to
app.use('/api', (req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const ua = /iPhone|iPad|Android|Windows|Mac/.exec(req.headers['user-agent'] || '')?.[0] || '?';
    console.log(`${res.statusCode} ${req.method} ${req.originalUrl.slice(0, 80)} ${req.headers.range || ''} ${Date.now() - t}ms ${ua}`);
  });
  next();
});
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

// ---------- Group key (keeps the server private to your people) ----------

// iOS's media player and home-screen apps don't reliably send cookies, so the app also carries
// a token derived from the key and puts it on URLs (?t=) and the socket handshake.
const TOKEN = GROUP_KEY ? crypto.createHash('sha256').update(`groove:${GROUP_KEY}`).digest('hex').slice(0, 24) : '';
const cookieKey = (header = '') => decodeURIComponent(/(?:^|;\s*)gk=([^;]*)/.exec(header)?.[1] || '');
const allowed = (cookie, token) => !GROUP_KEY || cookieKey(cookie) === GROUP_KEY || token === TOKEN;

app.post('/api/unlock', (req, res) => {
  // phones auto-capitalise and add spaces; compare loosely
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (GROUP_KEY && norm(req.body?.key) !== norm(GROUP_KEY)) return res.sendStatus(401);
  res.setHeader('set-cookie', `gk=${encodeURIComponent(GROUP_KEY)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  res.json({ token: TOKEN });
});

app.get('/api/health', (_req, res) => res.send('ok'));

// ---------- Where is the music server right now? ----------
// The PC's tunnel link changes on restart. The PC reports its link here (on Render, kept in Neon),
// and the APK / browsers look it up: GET /api/where, or open /go to be redirected.
let where = process.env.PUBLIC_URL || '';
async function loadWhere() {
  if (!pool) return where;
  const { rows } = await pool.query("select value from kv where key = 'tunnel'").catch(() => ({ rows: [] }));
  return rows[0]?.value || where;
}
app.get('/api/where', async (_req, res) => res.json({ url: await loadWhere() }));
app.get('/go', async (_req, res) => {
  const url = await loadWhere();
  url ? res.redirect(302, url) : res.status(503).send('Music server is offline');
});
app.post('/api/where', async (req, res) => {
  if (!GROUP_KEY || req.headers['x-group-key'] !== GROUP_KEY) return res.sendStatus(401);
  const url = String(req.body?.url || '');
  if (!/^https:\/\/[\w.-]+$/.test(url)) return res.sendStatus(400);
  where = url;
  await pool?.query("insert into kv (key, value) values ('tunnel', $1) on conflict (key) do update set value = $1", [url]);
  res.sendStatus(204);
});
app.use('/api', (req, res, next) => (allowed(req.headers.cookie, req.query.t || req.headers['x-groove-token']) ? next() : res.sendStatus(401)));
app.get('/api/me', (_req, res) => res.json({ ok: true, db: Boolean(pool), token: TOKEN }));
io.use((socket, next) => (allowed(socket.handshake.headers.cookie, socket.handshake.auth?.t) ? next() : next(new Error('locked'))));

// ---------- Neon: playlists shared with the group ----------

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
  : null;

await pool?.query(`
  create table if not exists shared_playlists (
    id uuid primary key,
    name text not null,
    owner text not null,
    tracks jsonb not null,
    updated_at timestamptz not null default now()
  )`);
await pool?.query('create table if not exists kv (key text primary key, value text not null)');

const needDb = (req, res, next) => (pool ? next() : req.method === 'GET' ? res.json([]) : res.status(503).json({ error: 'DATABASE_URL not set' }));

app.get('/api/group/playlists', needDb, async (_req, res) => {
  const { rows } = await pool.query('select id, name, owner, tracks, updated_at from shared_playlists order by updated_at desc');
  res.json(rows);
});

app.put('/api/group/playlists/:id', needDb, async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.sendStatus(400);
  const name = String(req.body?.name || 'Playlist').slice(0, 100);
  const owner = String(req.body?.owner || 'Someone').slice(0, 24);
  const tracks = cleanQueue(req.body?.tracks);
  await pool.query(
    `insert into shared_playlists (id, name, owner, tracks) values ($1, $2, $3, $4)
     on conflict (id) do update set name = $2, owner = $3, tracks = $4, updated_at = now()`,
    [id, name, owner, JSON.stringify(tracks)],
  );
  res.sendStatus(204);
});

app.delete('/api/group/playlists/:id', needDb, async (req, res) => {
  await pool.query('delete from shared_playlists where id = $1', [req.params.id]).catch(() => {});
  res.sendStatus(204);
});

// ---------- YouTube ----------

const searchCache = new Map(); // query -> { at, items }
const urlCache = new Map(); // videoId -> { at, p: Promise<string> }

const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// "Artist - Song (Official Video) [4K]" -> { artist: "Artist", title: "Song" }
const NOISE = /\s*[([][^)\]]*(official|video|audio|lyric|visuali[sz]er|music|hd|4k|mv|full song|explicit)[^)\]]*[)\]]/gi;
function tidy(rawTitle, channel) {
  let title = String(rawTitle || '').replace(NOISE, '').replace(/\s*\|.*$/, '').trim();
  let artist = String(channel || '').replace(/\s*-\s*Topic$|VEVO$|\s+Official$/i, '').trim();
  const dash = title.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (dash) [, artist, title] = dash;
  return { title: title || rawTitle, artist };
}

// YouTube Music search: ~0.5s, songs only, real artist names and square album art.
let ytm = null;
const music = () => (ytm ??= Innertube.create({ retrieve_player: false }).catch((e) => ((ytm = null), Promise.reject(e))));

// lh3 art URLs end in "=w60-h60-..." and can be resized by rewriting that suffix
const sized = (url, px) => url.replace(/=w\d+-h\d+.*$/, `=w${px}-h${px}-l90-rj`);

async function musicSearch(q) {
  const r = await (await music()).music.search(q, { type: 'song' });
  const songs = r.contents?.[0]?.contents ?? [];
  return songs
    .filter((s) => s.id && ID_RE.test(s.id) && s.duration?.seconds)
    .map((s) => {
      const t = s.thumbnails?.[0]?.url || '';
      return {
        id: s.id,
        title: s.title,
        artist: (s.artists ?? []).map((a) => a.name).join(', ') || s.author?.name || '',
        duration: s.duration.seconds,
        thumb: t ? sized(t, 120) : thumb(s.id),
        art: t ? sized(t, 544) : undefined,
      };
    });
}

// Songs YouTube Music would play after this one ("radio"), used for autoplay.
const relatedCache = new Map();
async function related(id) {
  const hit = relatedCache.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.items;
  const up = await (await music()).music.getUpNext(id, true);
  const items = (up.contents ?? [])
    .filter((v) => v.video_id && ID_RE.test(v.video_id) && v.video_id !== id && v.duration?.seconds)
    .map((v) => {
      const t = v.thumbnail?.[0]?.url || '';
      return {
        id: v.video_id,
        title: v.title?.toString() || '',
        artist: (v.artists ?? []).map((a) => a.name).join(', ') || v.author || '',
        duration: v.duration.seconds,
        thumb: t ? sized(t, 120) : thumb(v.video_id),
        art: t ? sized(t, 544) : undefined,
      };
    });
  relatedCache.set(id, { at: Date.now(), items });
  return items;
}

app.get('/api/related/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.sendStatus(400);
  try {
    res.json(await related(req.params.id));
  } catch (e) {
    console.error('related failed:', e.message);
    res.json([]);
  }
});

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json([]);
  try {
    const sections = await (await music()).music.getSearchSuggestions(q);
    const out = sections
      .flatMap((s) => s.contents ?? [])
      .map((c) => c.suggestion?.text)
      .filter(Boolean)
      .slice(0, 6);
    res.json(out);
  } catch {
    res.json([]);
  }
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json([]);
  const hit = searchCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < 6 * 3600e3) return res.json(hit.items);
  try {
    const items = await musicSearch(q);
    if (items.length) {
      searchCache.set(q.toLowerCase(), { at: Date.now(), items });
      return res.json(items);
    }
  } catch (e) {
    console.error('music search failed, falling back to yt-dlp:', e.message);
  }
  try {
    const r = await youtubedl(`ytsearch25:${q}`, {
      dumpSingleJson: true,
      flatPlaylist: true,
      skipDownload: true,
      noWarnings: true,
      ...ytOpts,
    });
    const items = (r.entries || [])
      .filter((e) => e.id && ID_RE.test(e.id) && e.duration && e.duration < 1800 && e.live_status !== 'is_live')
      .map((e) => ({
        id: e.id,
        ...tidy(e.title, e.channel || e.uploader),
        duration: Math.round(e.duration),
        thumb: thumb(e.id),
      }));
    searchCache.set(q.toLowerCase(), { at: Date.now(), items });
    res.json(items);
  } catch (e) {
    console.error('search failed:', e.stderr || e.message);
    res.status(502).json({ error: 'search failed' });
  }
});

// Direct googlevideo URLs expire after ~6h and are tied to this server's IP,
// so we resolve once, cache, and proxy the bytes (with Range support for seeking).
async function viaYtdlp(id) {
  const out = await youtubedl(`https://www.youtube.com/watch?v=${id}`, {
    getUrl: true,
    format: 'bestaudio[ext=m4a]/bestaudio',
    noPlaylist: true,
    noWarnings: true,
    ...ytOpts,
  });
  return String(out).trim().split('\n')[0];
}

// YouTube Music / iOS client URLs only serve the first ~1MB without a PO token, so yt-dlp
// is the one method that returns full songs. Kept as a list so more can be added.
const METHODS = [['yt-dlp', viaYtdlp]];

async function findUrl(id) {
  const errors = [];
  for (const [name, get] of METHODS) {
    try {
      const url = await get(id);
      const probe = await fetch(url, { headers: { range: 'bytes=1048576-1048577' } });
      if (probe.ok || probe.status === 416) return url; // 416 = song under 1MB
      errors.push(`${name}: HTTP ${probe.status}`);
    } catch (e) {
      errors.push(`${name}: ${String(e.stderr || e.message).split('\n').filter(Boolean).pop()?.slice(0, 160)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

function resolveUrl(id) {
  const c = urlCache.get(id);
  if (c && Date.now() - c.at < 3 * 3600e3) return c.p;
  const p = findUrl(id);
  urlCache.set(id, { at: Date.now(), p });
  p.catch(() => urlCache.delete(id));
  return p;
}

// googlevideo throttles large single requests to roughly realtime, so never ask for more than CHUNK at once.
// Ranges past the end of the file get 403 from googlevideo, so clamp to the known size.
const CHUNK = 2 * 1024 * 1024;
const sizes = new Map(); // id -> total bytes, learned from content-range

const totalOf = (up) => Number(/\/(\d+)$/.exec(up.headers.get('content-range') || '')?.[1]) || 0;

async function upstream(id, start, end) {
  if (!sizes.has(id)) {
    const probe = await fetch(await resolveUrl(id), { headers: { range: 'bytes=0-0' } });
    if (probe.ok) sizes.set(id, totalOf(probe));
    await probe.arrayBuffer().catch(() => {});
  }
  const total = sizes.get(id);
  if (total) end = Math.min(end, total - 1);
  const range = `bytes=${start}-${end}`;
  let up = await fetch(await resolveUrl(id), { headers: { range } });
  if (up.status === 403 || up.status === 410) {
    urlCache.delete(id);
    up = await fetch(await resolveUrl(id), { headers: { range } });
  }
  if (!up.ok) throw new Error(`upstream ${up.status}`);
  if (totalOf(up)) sizes.set(id, totalOf(up));
  return up;
}

app.get('/api/stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.sendStatus(400);
  let closed = false;
  res.on('close', () => (closed = true)); // req 'close' fires once the request is read, not on disconnect
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('cache-control', 'no-store');
  try {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      // Player seek/playback: one capped range, browser asks for more as needed.
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), start + CHUNK - 1) : start + CHUNK - 1;
      const up = await upstream(id, start, end);
      res.status(206);
      for (const h of ['content-type', 'content-length', 'content-range']) {
        const v = up.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      return Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
    }

    // Whole file (downloads): stitch sequential chunks into one 200 response.
    let up = await upstream(id, 0, CHUNK - 1);
    const total = totalOf(up);
    res.status(200);
    res.setHeader('content-type', up.headers.get('content-type') || 'audio/mp4');
    if (total) res.setHeader('content-length', total);
    for (let start = 0; ; ) {
      for await (const part of Readable.fromWeb(up.body)) {
        if (closed) return;
        if (!res.write(part)) await new Promise((r) => res.once('drain', r));
      }
      start += CHUNK;
      if (!total || start >= total || closed) break;
      up = await upstream(id, start, Math.min(start + CHUNK, total) - 1);
    }
    res.end();
  } catch (e) {
    console.error('stream failed:', id, e.stderr || e.message);
    urlCache.delete(id); // next attempt resolves a fresh URL
    if (!res.headersSent) res.status(502).type('text').send(String(e.message).slice(0, 600)); // reason visible to us when debugging
    else res.destroy();
  }
});

// ---------- Rooms (group listening) ----------

const rooms = new Map();
// Ready barrier: when a track starts or someone seeks, the room "waits" until every phone
// reports it has buffered that spot (or WAIT_MAX passes), then all start LEAD_MS later together.
// Without this, slow phones start late and spend the song jumping to catch up.
const WAIT_MAX = 6000;
const LEAD_MS = 350;

// only accept artwork from YouTube's own image hosts
const safeImg = (u) => (typeof u === 'string' && /^https:\/\/((lh3|yt3)\.googleusercontent\.com|i\.ytimg\.com)\//.test(u) ? u.slice(0, 500) : undefined);

const cleanTrack = (t) =>
  t && ID_RE.test(t.id)
    ? {
        id: t.id,
        title: String(t.title || '').slice(0, 200),
        artist: String(t.artist || '').slice(0, 100),
        duration: Number(t.duration) || 0,
        thumb: safeImg(t.thumb) || thumb(t.id),
        art: safeImg(t.art),
      }
    : null;
const cleanQueue = (q) => (Array.isArray(q) ? q : []).slice(0, 500).map(cleanTrack).filter(Boolean);
const clampIndex = (r, i) => Math.max(0, Math.min(r.queue.length - 1, Number(i) || 0));
const position = (r) => (r.paused || r.waiting ? r.position : Math.max(0, (Date.now() - r.startedAt) / 1000));

// Start (or resume after a seek) at `at` seconds once everyone is ready.
function startAt(r, index, at = 0) {
  r.index = index;
  r.position = at;
  r.paused = false;
  r.seq = (r.seq || 0) + 1;
  r.waiting = new Set(r.members.keys());
  const seq = r.seq;
  clearTimeout(r.waitTimer);
  r.waitTimer = setTimeout(() => release(r, seq), WAIT_MAX);
}

function release(r, seq) {
  if (r.seq !== seq || !r.waiting) return;
  r.waiting = null;
  r.startedAt = Date.now() + LEAD_MS - r.position * 1000;
  broadcast(r);
}

function stop(r) {
  r.paused = true;
  r.waiting = null;
  r.position = 0;
}

// End of queue: keep the music going with related songs, like Spotify autoplay.
async function advance(r) {
  if (r.index < r.queue.length - 1) return startAt(r, r.index + 1);
  const cur = r.queue[r.index];
  try {
    const have = new Set(r.queue.map((t) => t.id));
    const more = cur ? (await related(cur.id)).filter((t) => !have.has(t.id)).slice(0, 15) : [];
    if (more.length && r.queue[r.index] === cur) {
      r.queue.push(...cleanQueue(more));
      return startAt(r, r.index + 1);
    }
  } catch {}
  stop(r);
}

function snapshot(r) {
  return {
    code: r.code,
    queue: r.queue,
    index: r.index,
    paused: r.paused,
    position: r.position,
    startedAt: r.startedAt,
    waiting: Boolean(r.waiting),
    seq: r.seq || 0,
    members: [...r.members.values()],
  };
}

const broadcast = (r) => io.to(r.code).emit('state', snapshot(r));

io.on('connection', (socket) => {
  let room = null;

  socket.on('time', (ack) => typeof ack === 'function' && ack(Date.now()));

  socket.on('join', ({ code, name, seed } = {}) => {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!code) return;
    leave();
    let r = rooms.get(code);
    if (!r) {
      r = { code, queue: cleanQueue(seed?.queue), index: 0, paused: true, position: 0, startedAt: 0, members: new Map() };
      r.index = clampIndex(r, seed?.index);
      r.position = Math.max(0, Number(seed?.position) || 0);
      rooms.set(code, r);
    }
    clearTimeout(r.timer);
    r.members.set(socket.id, String(name || 'Guest').slice(0, 24));
    room = r;
    socket.join(code);
    broadcast(r);
  });

  socket.on('ready', ({ seq } = {}) => {
    const r = room;
    if (!r?.waiting || seq !== r.seq) return;
    r.waiting.delete(socket.id);
    if (!r.waiting.size) release(r, r.seq);
  });

  socket.on('control', async (a) => {
    const r = room;
    if (!r || !a || typeof a.type !== 'string') return;
    switch (a.type) {
      case 'play':
        // resume from pause: already buffered, so a short shared lead is enough
        if (r.paused && r.queue.length) {
          r.paused = false;
          r.waiting = null;
          r.startedAt = Date.now() + LEAD_MS - r.position * 1000;
        }
        break;
      case 'pause':
        if (!r.paused) {
          r.position = position(r);
          r.paused = true;
          r.waiting = null;
        }
        break;
      case 'seek': {
        const t = Math.max(0, Number(a.time) || 0);
        if (r.paused) r.position = t;
        else startAt(r, r.index, t); // everyone buffers the new spot, then resumes together
        break;
      }
      case 'setQueue':
        r.queue = cleanQueue(a.queue);
        if (r.queue.length) startAt(r, clampIndex(r, a.index));
        else stop(r);
        break;
      case 'reorder': {
        // shuffle/unshuffle: keep the current track playing where it is
        const q = cleanQueue(a.queue);
        const cur = r.queue[r.index];
        const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
        if (!q.length || i < 0) return;
        r.queue = q;
        r.index = i;
        break;
      }
      case 'playIndex':
        if (r.queue.length) startAt(r, clampIndex(r, a.index));
        break;
      case 'next':
        await advance(r);
        break;
      case 'prev':
        if (position(r) > 3) startAt(r, r.index);
        else startAt(r, Math.max(0, r.index - 1));
        break;
      case 'ended':
        // every client reports "ended"; only advance once per track
        if (a.index !== r.index || r.paused || r.waiting || position(r) < 2) return;
        r.position = 0;
        r.waiting = new Set(); // block duplicate "ended" while related songs load
        await advance(r);
        break;
      case 'enqueue': {
        const t = cleanTrack(a.track);
        if (!t || r.queue.length >= 500) return;
        r.queue.push(t);
        if (r.queue.length === 1) startAt(r, 0);
        break;
      }
      case 'remove': {
        const i = Number(a.index);
        if (!(i >= 0 && i < r.queue.length)) return;
        r.queue.splice(i, 1);
        if (i < r.index) r.index--;
        else if (i === r.index) {
          if (r.queue.length) startAt(r, Math.min(r.index, r.queue.length - 1));
          else stop(r);
        }
        break;
      }
      default:
        return;
    }
    broadcast(r);
  });

  function leave() {
    const r = room;
    if (!r) return;
    room = null;
    socket.leave(r.code);
    r.members.delete(socket.id);
    if (r.waiting?.delete(socket.id) && !r.waiting.size) release(r, r.seq);
    if (r.members.size) broadcast(r);
    else r.timer = setTimeout(() => rooms.delete(r.code), 30 * 60e3);
  }

  socket.on('leave', leave);
  socket.on('disconnect', leave);
});

// ---------- Static PWA ----------

const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

http.listen(PORT, () => console.log(`sunaan server on http://localhost:${PORT}`));

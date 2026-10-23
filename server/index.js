import express from 'express';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import youtubedl from 'youtube-dl-exec';
import pg from 'pg';

const PORT = Number(process.env.PORT) || 3001;
const GROUP_KEY = process.env.GROUP_KEY || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[\w-]{11}$/;

// Render's IPs often get YouTube's "confirm you're not a bot" wall; exported cookies fix it.
// Several player clients: when YouTube challenges one (common on cloud IPs), yt-dlp falls back to the next.
const ytOpts = {
  extractorArgs: `youtube:player_client=${process.env.YTDLP_CLIENTS || 'default,tv,web_safari,mweb'}`,
};
if (process.env.YTDLP_COOKIES) {
  const file = path.join(process.env.TMPDIR || '/tmp', 'yt-cookies.txt');
  fs.writeFileSync(file, process.env.YTDLP_COOKIES);
  ytOpts.cookies = file;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

// ---------- Group key (keeps the server private to your people) ----------

const cookieKey = (header = '') => decodeURIComponent(/(?:^|;\s*)gk=([^;]*)/.exec(header)?.[1] || '');
const allowed = (cookie) => !GROUP_KEY || cookieKey(cookie) === GROUP_KEY;

app.post('/api/unlock', (req, res) => {
  if (GROUP_KEY && req.body?.key !== GROUP_KEY) return res.sendStatus(401);
  res.setHeader('set-cookie', `gk=${encodeURIComponent(GROUP_KEY)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  res.sendStatus(204);
});

app.get('/api/health', (_req, res) => res.send('ok'));
app.use('/api', (req, res, next) => (allowed(req.headers.cookie) ? next() : res.sendStatus(401)));
app.get('/api/me', (_req, res) => res.json({ ok: true, db: Boolean(pool) }));
io.use((socket, next) => (allowed(socket.handshake.headers.cookie) ? next() : next(new Error('locked'))));

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

const needDb = (_req, res, next) => (pool ? next() : res.status(503).json({ error: 'DATABASE_URL not set' }));

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

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json([]);
  const hit = searchCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < 6 * 3600e3) return res.json(hit.items);
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
function resolveUrl(id) {
  const c = urlCache.get(id);
  if (c && Date.now() - c.at < 3 * 3600e3) return c.p;
  const p = youtubedl(`https://www.youtube.com/watch?v=${id}`, {
    getUrl: true,
    format: 'bestaudio[ext=m4a]/bestaudio',
    noPlaylist: true,
    noWarnings: true,
    ...ytOpts,
  }).then((out) => String(out).trim().split('\n')[0]);
  urlCache.set(id, { at: Date.now(), p });
  p.catch(() => urlCache.delete(id));
  return p;
}

// googlevideo throttles large single requests to roughly realtime, so never ask for more than CHUNK at once.
const CHUNK = 4 * 1024 * 1024;

async function upstream(id, start, end) {
  const range = `bytes=${start}-${end}`;
  let up = await fetch(await resolveUrl(id), { headers: { range } });
  if (up.status === 403 || up.status === 410) {
    urlCache.delete(id);
    up = await fetch(await resolveUrl(id), { headers: { range } });
  }
  if (!up.ok) throw new Error(`upstream ${up.status}`);
  return up;
}

const totalOf = (up) => Number(/\/(\d+)$/.exec(up.headers.get('content-range') || '')?.[1]) || 0;

app.get('/api/stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.sendStatus(400);
  let closed = false;
  req.on('close', () => (closed = true));
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
    if (!res.headersSent) res.sendStatus(502);
    else res.destroy();
  }
});

// ---------- Rooms (group listening) ----------

const rooms = new Map();
const LEAD_MS = 800; // gives every client time to buffer before a track starts

const cleanTrack = (t) =>
  t && ID_RE.test(t.id)
    ? {
        id: t.id,
        title: String(t.title || '').slice(0, 200),
        artist: String(t.artist || '').slice(0, 100),
        duration: Number(t.duration) || 0,
        thumb: thumb(t.id),
      }
    : null;
const cleanQueue = (q) => (Array.isArray(q) ? q : []).slice(0, 500).map(cleanTrack).filter(Boolean);
const clampIndex = (r, i) => Math.max(0, Math.min(r.queue.length - 1, Number(i) || 0));
const position = (r) => (r.paused ? r.position : Math.max(0, (Date.now() - r.startedAt) / 1000));

function startAt(r, index) {
  r.index = index;
  r.position = 0;
  r.paused = false;
  r.startedAt = Date.now() + LEAD_MS;
}

function stop(r) {
  r.paused = true;
  r.position = 0;
}

function snapshot(r) {
  return {
    code: r.code,
    queue: r.queue,
    index: r.index,
    paused: r.paused,
    position: r.position,
    startedAt: r.startedAt,
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

  socket.on('control', (a) => {
    const r = room;
    if (!r || !a || typeof a.type !== 'string') return;
    switch (a.type) {
      case 'play':
        if (r.paused && r.queue.length) {
          r.paused = false;
          r.startedAt = Date.now() - r.position * 1000 + 300;
        }
        break;
      case 'pause':
        if (!r.paused) {
          r.position = position(r);
          r.paused = true;
        }
        break;
      case 'seek': {
        const t = Math.max(0, Number(a.time) || 0);
        if (r.paused) r.position = t;
        else r.startedAt = Date.now() - t * 1000 + 300;
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
        if (r.index < r.queue.length - 1) startAt(r, r.index + 1);
        else stop(r);
        break;
      case 'prev':
        if (position(r) > 3) startAt(r, r.index);
        else startAt(r, Math.max(0, r.index - 1));
        break;
      case 'ended':
        // every client reports "ended"; only advance once per track
        if (a.index !== r.index || r.paused || position(r) < 2) return;
        if (r.index < r.queue.length - 1) startAt(r, r.index + 1);
        else stop(r);
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

http.listen(PORT, () => console.log(`groove server on http://localhost:${PORT}`));

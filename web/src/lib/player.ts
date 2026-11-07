import { api } from './auth';
import { createStore } from './store';
import { getAudio, type Track } from './db';
import { pushHistory } from './history';

export type Action =
  | { type: 'setQueue'; queue: Track[]; index: number }
  | { type: 'playIndex'; index: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'enqueue'; track: Track }
  | { type: 'remove'; index: number }
  | { type: 'ended'; index: number }
  | { type: 'reorder'; queue: Track[] }; // same tracks, new order, current keeps playing

export type RoomState = {
  code: string;
  queue: Track[];
  index: number;
  paused: boolean;
  position: number;
  startedAt: number; // server epoch ms
  waiting: boolean; // room is waiting for every phone to buffer
  seq: number;
  members: string[];
};

export const player = createStore({
  queue: [] as Track[],
  index: 0,
  playing: false,
  time: 0,
  duration: 0,
  buffering: false,
  needsTap: false, // iOS blocked autoplay; user must tap once
  error: null as string | null,
  repeat: (localStorage.getItem('groove:repeat') || 'off') as 'off' | 'all' | 'one',
  shuffle: false,
  autoplay: localStorage.getItem('groove:autoplay') !== 'off',
});

export function toggleAutoplay() {
  const on = !player.get().autoplay;
  localStorage.setItem('groove:autoplay', on ? 'on' : 'off');
  player.set({ autoplay: on });
}

// Autoplay: when the queue runs out, append songs YouTube Music would play next.
let extending: string | null = null;
async function extendQueue() {
  const { queue, index, autoplay } = player.get();
  const cur = queue[index];
  if (!cur || !autoplay || extending === cur.id) return false;
  extending = cur.id;
  try {
    const res = await fetch(api(`/api/related/${cur.id}`));
    const items: Track[] = res.ok ? await res.json() : [];
    const have = new Set(player.get().queue.map((t) => t.id));
    const more = items.filter((t) => !have.has(t.id)).slice(0, 15);
    if (!more.length) return false;
    player.set({ queue: [...player.get().queue, ...more] });
    return true;
  } catch {
    return false;
  } finally {
    extending = null;
  }
}

export function cycleRepeat() {
  const next = ({ off: 'all', all: 'one', one: 'off' } as const)[player.get().repeat];
  localStorage.setItem('groove:repeat', next);
  player.set({ repeat: next });
}

let unshuffled: Track[] | null = null;

export function toggleShuffle() {
  const { queue, index, shuffle } = player.get();
  const cur = queue[index];
  if (!cur) return;
  if (!shuffle) {
    unshuffled = queue;
    const rest = queue.filter((_, i) => i !== index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    dispatch({ type: 'reorder', queue: [cur, ...rest] });
  } else if (unshuffled) {
    const ids = new Set(queue.map((t) => t.id));
    dispatch({ type: 'reorder', queue: unshuffled.filter((t) => ids.has(t.id)) });
  }
  player.set({ shuffle: !shuffle });
}

export const audio = new Audio();
audio.preload = 'auto';

// ---------- loading ----------

let loadedId: string | null = null;
let objectUrl: string | null = null;

async function load(t: Track) {
  if (loadedId === t.id) return;
  loadedId = t.id;
  const blob = await getAudio(t.id).catch(() => undefined);
  if (loadedId !== t.id) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = blob ? URL.createObjectURL(blob) : null;
  audio.src = objectUrl ?? api(`/api/stream/${t.id}`);
  player.set({ time: 0, duration: t.duration, error: null });
  setMediaSession(t);
  pushHistory(t);
  prepareNext();
}

// The server needs ~30s to unlock a song it has not seen, so ask it to start on the next ones
// while this one plays. With autoplay, fetch the up-next list early so there is a next song to warm.
function prepareNext(again = true) {
  const { queue, index } = player.get();
  const next = queue.slice(index + 1, index + 3);
  if (next.length) fetch(api(`/api/prepare?ids=${next.map((t) => t.id).join(',')}`)).catch(() => {});
  else if (again && !room && index === queue.length - 1) void extendQueue().then((ok) => ok && prepareNext(false));
}


function whenReady() {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    audio.addEventListener('loadedmetadata', done);
    audio.addEventListener('error', done);
    setTimeout(done, 15000);
  });
}

function play() {
  audio
    .play()
    .then(() => player.set({ needsTap: false }))
    .catch((e) => {
      if (e?.name === 'NotAllowedError') player.set({ needsTap: true });
    });
}

export function tapToPlay() {
  player.set({ needsTap: false });
  if (room) syncRoom();
  else play();
}

// ---------- actions ----------

let remote: ((a: Action) => void) | null = null;
export const setRemote = (r: typeof remote) => (remote = r);

export function dispatch(a: Action) {
  if (remote) {
    if (a.type === 'pause') audio.pause(); // feel instant; the server confirms for everyone
    remote(a);
  } else void local(a);
}

async function startCurrent() {
  const t = player.get().queue[player.get().index];
  if (!t) return;
  await load(t);
  audio.currentTime = 0;
  play();
}

async function local(a: Action) {
  const { queue, index } = player.get();
  switch (a.type) {
    case 'setQueue':
      player.set({ queue: a.queue, index: a.index });
      return startCurrent();
    case 'playIndex':
      player.set({ index: a.index });
      return startCurrent();
    case 'play':
      return play();
    case 'pause':
      return audio.pause();
    case 'seek':
      audio.currentTime = a.time;
      return;
    case 'reorder': {
      const cur = queue[index];
      const i = cur ? a.queue.findIndex((t) => t.id === cur.id) : -1;
      player.set({ queue: a.queue, index: Math.max(0, i) });
      return;
    }
    case 'next':
    case 'ended':
      if (index >= queue.length - 1 && !(await extendQueue())) {
        audio.pause();
        return;
      }
      player.set({ index: player.get().index + 1 });
      return startCurrent();
    case 'prev':
      if (audio.currentTime > 3 || index === 0) audio.currentTime = 0;
      else {
        player.set({ index: index - 1 });
        return startCurrent();
      }
      return;
    case 'enqueue':
      player.set({ queue: [...queue, a.track] });
      if (!queue.length) return startCurrent();
      return;
    case 'remove': {
      const q = queue.filter((_, i) => i !== a.index);
      if (a.index < index) player.set({ queue: q, index: index - 1 });
      else if (a.index === index) {
        player.set({ queue: q, index: Math.min(index, q.length - 1) });
        if (q.length) return startCurrent();
        audio.pause();
      } else player.set({ queue: q });
      return;
    }
  }
}

// ---------- room sync ----------
//
// The server holds one shared timeline. When a track starts or someone seeks, the room
// "waits": every phone loads and buffers that spot, reports ready, and the server then
// sets a start moment slightly in the future. Everyone starts at that exact moment
// (clock offset measured in room.ts), then small drift is fixed by nudging speed.

let room: RoomState | null = null;
let serverNow = () => Date.now();
let startTimer: ReturnType<typeof setTimeout> | undefined;
let sendReady: ((seq: number) => void) | null = null;
let readySent = -1;
let lastSeek = 0;

export const setReadySender = (f: typeof sendReady) => (sendReady = f);

export function applyRoom(rs: RoomState, now: () => number) {
  room = rs;
  serverNow = now;
  player.set({ queue: rs.queue, index: rs.index });
  void syncRoom();
}

export function leaveRoomPlayback() {
  room = null;
  readySent = -1;
  clearTimeout(startTimer);
  audio.playbackRate = 1;
}

// Where the shared timeline is right now, in seconds.
const roomTarget = (rs: RoomState) =>
  rs.paused || rs.waiting ? rs.position : (serverNow() - rs.startedAt) / 1000;

function seekTo(t: number) {
  if (Math.abs(audio.currentTime - t) < 0.05) return;
  audio.currentTime = Math.max(0, t);
  lastSeek = Date.now();
}

function whenBuffered() {
  if (audio.readyState >= 3) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      audio.removeEventListener('canplay', done);
      resolve();
    };
    audio.addEventListener('canplay', done);
    setTimeout(done, 8000);
  });
}

async function syncRoom() {
  const rs = room;
  if (!rs) return;
  clearTimeout(startTimer);
  const t = rs.queue[rs.index];
  if (!t) {
    audio.pause();
    return;
  }
  await load(t);
  await whenReady();
  if (rs !== room) return;

  if (rs.paused) {
    audio.pause();
    audio.playbackRate = 1;
    if (Math.abs(audio.currentTime - rs.position) > 0.3) seekTo(rs.position);
    return;
  }

  if (rs.waiting) {
    // park at the start spot, buffer it, tell the server we're ready
    audio.pause();
    audio.playbackRate = 1;
    seekTo(rs.position);
    await whenBuffered();
    if (rs === room && readySent !== rs.seq) {
      readySent = rs.seq;
      sendReady?.(rs.seq);
    }
    return;
  }

  // released: rs.position starts playing at this server time
  const wait = rs.startedAt + rs.position * 1000 - serverNow();
  if (wait > 15) {
    audio.pause();
    seekTo(rs.position);
    startTimer = setTimeout(syncRoom, wait);
    return;
  }
  const target = roomTarget(rs);
  if (Math.abs(audio.currentTime - target) > 0.25) seekTo(target);
  audio.playbackRate = 1;
  if (audio.paused) play();
}

// Proportional speed nudge (inaudible) for small drift; a jump only for big drift,
// and never again within a couple of seconds of the last jump (seeks need to settle).
function correctDrift(target: number) {
  if (Date.now() - lastSeek < 2500) return;
  const drift = audio.currentTime - target;
  if (Math.abs(drift) > 0.6) {
    seekTo(target + 0.12); // a seek costs ~100ms on phones
    audio.playbackRate = 1;
  } else if (Math.abs(drift) > 0.03) {
    audio.playbackRate = 1 - Math.max(-0.05, Math.min(0.05, drift * 0.3));
  } else audio.playbackRate = 1;
}

setInterval(() => {
  if (room && !room.paused && !room.waiting && !audio.paused && !player.get().buffering) {
    const target = roomTarget(room);
    if (target >= 0) correctDrift(target);
  }
}, 500);

// ---------- audio events ----------

let lastPosition = 0;
// YouTube audio is fragmented MP4, and some players (Safari especially) read it as about twice
// as long, then play silence after the real end. Trust YouTube's length when the two disagree.
const metaLen = () => player.get().queue[player.get().index]?.duration || 0;
const tooLong = () => metaLen() > 0 && Number.isFinite(audio.duration) && audio.duration > metaLen() * 1.25;
const realDuration = () => (tooLong() ? metaLen() : audio.duration);
let fakeEndFor = '';
audio.addEventListener('timeupdate', () => {
  player.set({ time: audio.currentTime });
  const p = player.get();
  const id = p.queue[p.index]?.id || '';
  if (tooLong() && audio.currentTime >= metaLen() + 1 && fakeEndFor !== id) {
    fakeEndFor = id;
    return onEnded();
  }
  if (!room && p.index === p.queue.length - 1 && p.duration - audio.currentTime < 30) void extendQueue();
  // keeps the notification / lock screen seek bar in step
  if ('mediaSession' in navigator && Date.now() - lastPosition > 1000 && Number.isFinite(audio.duration)) {
    lastPosition = Date.now();
    try {
      navigator.mediaSession.setPositionState({ duration: realDuration(), position: Math.min(audio.currentTime, realDuration()), playbackRate: 1 });
    } catch {}
  }
});
const setPlaybackState = (s: MediaSessionPlaybackState) => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s;
};
audio.addEventListener('play', () => setPlaybackState('playing'));
audio.addEventListener('pause', () => setPlaybackState('paused'));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) player.set({ duration: realDuration() });
});
audio.addEventListener('play', () => player.set({ playing: true }));
audio.addEventListener('pause', () => player.set({ playing: false }));
audio.addEventListener('waiting', () => player.set({ buffering: true }));
audio.addEventListener('playing', () => player.set({ buffering: false }));
audio.addEventListener('canplay', () => player.set({ buffering: false }));
audio.addEventListener('ended', () => onEnded());
function onEnded() {
  const { repeat, index, queue } = player.get();
  if (repeat === 'one') {
    dispatch({ type: 'seek', time: 0 });
    if (!remote) play();
  } else if (repeat === 'all' && index >= queue.length - 1 && queue.length) dispatch({ type: 'playIndex', index: 0 });
  else dispatch({ type: 'ended', index });
}
// Streams can fail transiently (server waking up, expired YouTube URL). Retry quietly from the
// same position before telling the user anything.
let retries = 0;
let retryFor: string | null = null;
audio.addEventListener('error', () => {
  if (!audio.src || audio.src === silent || !loadedId) return;
  if (retryFor !== loadedId) {
    retryFor = loadedId;
    retries = 0;
  }
  if (!objectUrl && navigator.onLine && retries < 3) {
    retries++;
    const id = loadedId;
    const at = audio.currentTime;
    player.set({ buffering: true });
    setTimeout(() => {
      if (loadedId !== id) return;
      audio.src = api(`/api/stream/${id}?retry=${retries}`);
      audio.currentTime = at;
      if (room) void syncRoom();
      else play();
    }, 700 * retries);
    return;
  }
  if (!navigator.onLine) return player.set({ error: 'Offline', buffering: false });
  // tell "server is down" apart from "this song is broken"
  fetch(api('/api/health'), { cache: 'no-store' })
    .then((r) => r.ok)
    .catch(() => false)
    .then((up) => player.set({ error: up ? "Can't play this song" : 'Server offline', buffering: false }));
});
audio.addEventListener('playing', () => {
  if (player.get().error) player.set({ error: null });
});


// iOS only lets an <audio> play programmatically after one play() inside a user gesture.
const silent = (() => {
  const b = new ArrayBuffer(44 + 200);
  const v = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 236, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, 200, true);
  new Uint8Array(b, 44).fill(128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
})();

function unlock() {
  window.removeEventListener('pointerdown', unlock, true);
  if (audio.src) return;
  audio.src = silent;
  audio.play().then(() => {
    if (audio.src === silent) {
      audio.pause();
      audio.removeAttribute('src');
    }
  }).catch(() => {});
}
window.addEventListener('pointerdown', unlock, true);

// ---------- lock screen / notification controls ----------

function setMediaSession(t: Track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    artwork: [
      ...(t.art ? [{ src: t.art, sizes: '544x544', type: 'image/jpeg' }] : []),
      { src: `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
      { src: `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
    ],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => dispatch({ type: 'play' }));
  ms.setActionHandler('pause', () => dispatch({ type: 'pause' }));
  ms.setActionHandler('nexttrack', () => dispatch({ type: 'next' }));
  ms.setActionHandler('previoustrack', () => dispatch({ type: 'prev' }));
  try {
    ms.setActionHandler('seekto', (d) => d.seekTime != null && dispatch({ type: 'seek', time: d.seekTime }));
    ms.setActionHandler('seekbackward', (d) => dispatch({ type: 'seek', time: Math.max(0, audio.currentTime - (d.seekOffset || 10)) }));
    ms.setActionHandler('seekforward', (d) => dispatch({ type: 'seek', time: audio.currentTime + (d.seekOffset || 10) }));
  } catch {}
}

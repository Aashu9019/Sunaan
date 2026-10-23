import { createStore } from './store';
import { getAudio, type Track } from './db';

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
  | { type: 'ended'; index: number };

export type RoomState = {
  code: string;
  queue: Track[];
  index: number;
  paused: boolean;
  position: number;
  startedAt: number; // server epoch ms
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
});

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
  audio.src = objectUrl ?? `/api/stream/${t.id}`;
  player.set({ time: 0, duration: t.duration, error: null });
  setMediaSession(t);
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
  if (remote) remote(a);
  else void local(a);
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
    case 'next':
    case 'ended':
      if (index < queue.length - 1) {
        player.set({ index: index + 1 });
        return startCurrent();
      }
      audio.pause();
      return;
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

let room: RoomState | null = null;
let serverNow = () => Date.now();
let startTimer: ReturnType<typeof setTimeout> | undefined;

export function applyRoom(rs: RoomState, now: () => number) {
  room = rs;
  serverNow = now;
  player.set({ queue: rs.queue, index: rs.index });
  void syncRoom();
}

export function leaveRoomPlayback() {
  room = null;
  clearTimeout(startTimer);
  audio.playbackRate = 1;
}

const roomTarget = (rs: RoomState) => (rs.paused ? rs.position : (serverNow() - rs.startedAt) / 1000);

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
  const target = roomTarget(rs);
  if (rs.paused) {
    audio.pause();
    audio.playbackRate = 1;
    if (Math.abs(audio.currentTime - target) > 0.3) audio.currentTime = target;
    return;
  }
  if (target < 0) {
    // scheduled start: wait so everyone begins together
    audio.pause();
    audio.currentTime = 0;
    startTimer = setTimeout(syncRoom, -target * 1000);
    return;
  }
  correctDrift(target);
  if (audio.paused) play();
}

// Big drift: jump. Small drift: nudge speed so it's inaudible.
function correctDrift(target: number) {
  const drift = audio.currentTime - target;
  if (Math.abs(drift) > 1) {
    audio.currentTime = target;
    audio.playbackRate = 1;
  } else if (Math.abs(drift) > 0.05) audio.playbackRate = drift > 0 ? 0.96 : 1.04;
  else audio.playbackRate = 1;
}

setInterval(() => {
  if (room && !room.paused && !audio.paused && !player.get().buffering) {
    const target = roomTarget(room);
    if (target >= 0) correctDrift(target);
  }
}, 1000);

// ---------- audio events ----------

audio.addEventListener('timeupdate', () => player.set({ time: audio.currentTime }));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) player.set({ duration: audio.duration });
});
audio.addEventListener('play', () => player.set({ playing: true }));
audio.addEventListener('pause', () => player.set({ playing: false }));
audio.addEventListener('waiting', () => player.set({ buffering: true }));
audio.addEventListener('playing', () => player.set({ buffering: false }));
audio.addEventListener('canplay', () => player.set({ buffering: false }));
audio.addEventListener('ended', () => dispatch({ type: 'ended', index: player.get().index }));
audio.addEventListener('error', () => {
  if (audio.src) player.set({ error: navigator.onLine ? "Can't play" : 'Offline', buffering: false });
});

// After a seek/rejoin while in a room, resync once data is available.
audio.addEventListener('playing', () => {
  if (room && !room.paused) {
    const target = roomTarget(room);
    if (target >= 0 && Math.abs(audio.currentTime - target) > 1) audio.currentTime = target;
  }
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
  } catch {}
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlaylist, requestNotificationPermissionsAsync, setAudioModeAsync, type AudioPlaylist, type AudioPlaylistStatus } from 'expo-audio';
import { pushHistory } from './history';
import { localUri } from './library';
import { api, getJSON, timedFetch } from './server';
import { toast } from './ui';
import { createStore } from './store';
import { artOf, type Track } from './types';

// Playback runs on expo-audio's native playlist: it keeps playing with the screen off,
// moves to the next song by itself, and shows controls in the notification / lock screen.
// Our queue (below) is the source of truth; the native playlist mirrors it.

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
  | { type: 'reorder'; queue: Track[] };

export type RoomState = {
  code: string;
  queue: Track[];
  index: number;
  paused: boolean;
  position: number;
  startedAt: number;
  waiting: boolean;
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
  repeat: 'off' as 'off' | 'all' | 'one',
  shuffle: false,
  autoplay: true,
});

let pl: AudioPlaylist;
let nativeIds: string[] = []; // what the native playlist currently holds
let lockScreenOn = false;
let ignoreTrackChange = 0;

const source = (t: Track) => ({ uri: localUri(t.id) ?? api(`/api/stream/${t.id}`) });
const meta = (t: Track) => ({ title: t.title, artist: t.artist, artworkUrl: artOf(t) });
const loopMode = (r: string) => (r === 'one' ? 'single' : r === 'all' ? 'all' : 'none') as 'single' | 'all' | 'none';

export async function initPlayer() {
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
  requestNotificationPermissionsAsync().catch(() => {}); // Android 13+: needed for the media notification
  pl = createAudioPlaylist({ sources: [], updateInterval: 500, loop: 'none' });
  pl.addListener('playlistStatusUpdate', onStatus);
  pl.addListener('trackChanged', ({ currentIndex }) => onTrackChanged(currentIndex));
  const [[, repeat], [, autoplay]] = await AsyncStorage.multiGet(['sunaan:repeat', 'sunaan:autoplay']);
  player.set({ repeat: (repeat as 'off' | 'all' | 'one') || 'off', autoplay: autoplay !== 'off' });
  pl.loop = loopMode(player.get().repeat);
}

function loadNative(queue: Track[], index: number) {
  ignoreTrackChange++;
  pl.clear();
  queue.forEach((t) => pl.add(source(t)));
  nativeIds = queue.map((t) => t.id);
  if (index > 0) pl.skipTo(index);
  setTimeout(() => ignoreTrackChange--, 300);
  showTrack(queue[index]);
}

function skipNative(index: number) {
  ignoreTrackChange++;
  pl.skipTo(index);
  setTimeout(() => ignoreTrackChange--, 300);
  showTrack(player.get().queue[index]);
}

// The native player fails silently, so ask the server about streamed songs and say why if it can't.
function checkStream(t: Track) {
  if (localUri(t.id)) return;
  timedFetch(api(`/api/stream/${t.id}`), { headers: { range: 'bytes=0-1' } }, 30000)
    .then((r) => {
      if (r.ok || player.get().queue[player.get().index]?.id !== t.id) return;
      toast(r.status === 502 ? 'YouTube is blocking the server right now' : r.status === 401 ? 'Group key needed' : "Can't play this song");
    })
    .catch(() => {});
}

// The server needs ~30s to unlock a song it has not seen, so ask it to start on the next ones
// while this one plays. With autoplay, fetch the up-next list early so there is a next song to warm.
function prepareNext(again = true) {
  const { queue, index } = player.get();
  const next = queue.slice(index + 1, index + 3).filter((t) => !localUri(t.id));
  if (next.length) fetch(api(`/api/prepare?ids=${next.map((t) => t.id).join(',')}`)).catch(() => {});
  else if (again && !room && index === queue.length - 1) void extendQueue().then((ok) => ok && prepareNext(false));
}

function showTrack(t?: Track) {
  if (!t) return;
  pushHistory(t);
  checkStream(t);
  prepareNext();
  if (!lockScreenOn) {
    pl.setActiveForLockScreen(true, meta(t), { showNextTrack: true, showPreviousTrack: true });
    lockScreenOn = true;
  } else pl.updateLockScreenMetadata(meta(t));
}

function appendNative(tracks: Track[]) {
  tracks.forEach((t) => pl.add(source(t)));
  nativeIds.push(...tracks.map((t) => t.id));
}

// ---------- status from native ----------

function onStatus(s: AudioPlaylistStatus) {
  const { queue, index } = player.get();
  player.set({
    playing: s.playing,
    time: s.currentTime,
    duration: s.duration || queue[index]?.duration || 0,
    buffering: s.isBuffering,
  });
  // autoplay: fetch more songs before the last one ends so the native player never runs dry
  if (!room && index === queue.length - 1 && s.duration > 0 && s.duration - s.currentTime < 30) void extendQueue();
  if (s.didJustFinish && index === queue.length - 1) {
    if (room) remote?.({ type: 'ended', index });
    else if (player.get().autoplay) void extendQueue().then((ok) => ok && dispatch({ type: 'playIndex', index: index + 1 }));
  }
}

function onTrackChanged(currentIndex: number) {
  if (ignoreTrackChange > 0) return;
  const prev = player.get().index;
  if (currentIndex === prev) return;
  if (room) {
    // the native player moved on its own (song ended, or lock-screen next): let the room decide
    const nearEnd = player.get().duration - player.get().time < 3;
    remote?.(currentIndex === prev + 1 && nearEnd ? { type: 'ended', index: prev } : { type: 'playIndex', index: currentIndex });
    return;
  }
  player.set({ index: currentIndex, time: 0 });
  showTrack(player.get().queue[currentIndex]);
}

// ---------- autoplay ----------

let extending: string | null = null;
async function extendQueue() {
  const { queue, index, autoplay } = player.get();
  const cur = queue[index];
  if (!cur || !autoplay || extending === cur.id) return false;
  extending = cur.id;
  try {
    const items = await getJSON<Track[]>(`/api/related/${cur.id}`, []);
    const have = new Set(player.get().queue.map((t) => t.id));
    const more = items.filter((t) => !have.has(t.id)).slice(0, 15);
    if (!more.length) return false;
    player.set({ queue: [...player.get().queue, ...more] });
    appendNative(more);
    return true;
  } finally {
    extending = null;
  }
}

export function toggleAutoplay() {
  const on = !player.get().autoplay;
  player.set({ autoplay: on });
  AsyncStorage.setItem('sunaan:autoplay', on ? 'on' : 'off').catch(() => {});
}

export function cycleRepeat() {
  const next = ({ off: 'all', all: 'one', one: 'off' } as const)[player.get().repeat];
  player.set({ repeat: next });
  pl.loop = loopMode(next);
  AsyncStorage.setItem('sunaan:repeat', next).catch(() => {});
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

// ---------- actions ----------

let remote: ((a: Action) => void) | null = null;
export const setRemote = (r: typeof remote) => (remote = r);

export function dispatch(a: Action) {
  if (remote) {
    if (a.type === 'pause') pl.pause(); // instant; the room confirms for everyone
    remote(a);
  } else local(a);
}

function local(a: Action) {
  const { queue, index } = player.get();
  switch (a.type) {
    case 'setQueue':
      player.set({ queue: a.queue, index: a.index, time: 0 });
      loadNative(a.queue, a.index);
      return pl.play();
    case 'playIndex':
      player.set({ index: a.index, time: 0 });
      skipNative(a.index);
      return pl.play();
    case 'play':
      return pl.play();
    case 'pause':
      return pl.pause();
    case 'seek':
      return void pl.seekTo(a.time);
    case 'next':
    case 'ended':
      if (index < queue.length - 1) return local({ type: 'playIndex', index: index + 1 });
      return void extendQueue().then((ok) => ok && local({ type: 'playIndex', index: index + 1 }));
    case 'prev':
      if (player.get().time > 3 || index === 0) return void pl.seekTo(0);
      return local({ type: 'playIndex', index: index - 1 });
    case 'enqueue':
      player.set({ queue: [...queue, a.track] });
      appendNative([a.track]);
      if (!queue.length) local({ type: 'playIndex', index: 0 });
      return;
    case 'remove': {
      const q = queue.filter((_, i) => i !== a.index);
      ignoreTrackChange++;
      pl.remove(a.index);
      nativeIds.splice(a.index, 1);
      setTimeout(() => ignoreTrackChange--, 300);
      player.set({ queue: q, index: a.index < index ? index - 1 : Math.min(index, q.length - 1) });
      return;
    }
    case 'reorder': {
      const cur = queue[index];
      const i = Math.max(0, cur ? a.queue.findIndex((t) => t.id === cur.id) : 0);
      const at = player.get().time;
      const wasPlaying = player.get().playing;
      player.set({ queue: a.queue, index: i });
      loadNative(a.queue, i);
      void pl.seekTo(at);
      if (wasPlaying) pl.play();
      return;
    }
  }
}

// ---------- room sync (same scheme as the website) ----------
//
// The room waits until every phone has buffered the start spot, then the server picks a
// start moment slightly in the future and everyone starts together. Small drift is fixed
// by nudging speed a few percent; only big drift causes a jump.

let room: RoomState | null = null;
let serverNow = () => Date.now();
let startTimer: ReturnType<typeof setTimeout> | undefined;
let sendReady: ((seq: number) => void) | null = null;
let readySent = -1;
let lastSeek = 0;

export const setReadySender = (f: typeof sendReady) => (sendReady = f);

const sameQueue = (q: Track[]) => q.length === nativeIds.length && q.every((t, i) => t.id === nativeIds[i]);

export function applyRoom(rs: RoomState, now: () => number) {
  room = rs;
  serverNow = now;
  if (!sameQueue(rs.queue)) {
    player.set({ queue: rs.queue, index: rs.index });
    pl.pause();
    if (rs.queue.length) loadNative(rs.queue, rs.index);
  } else if (pl.currentIndex !== rs.index) {
    player.set({ index: rs.index });
    skipNative(rs.index);
  } else player.set({ queue: rs.queue, index: rs.index });
  void syncRoom();
}

export function leaveRoomPlayback() {
  room = null;
  readySent = -1;
  clearTimeout(startTimer);
  pl.playbackRate = 1;
}

const target = (rs: RoomState) => (rs.paused || rs.waiting ? rs.position : (serverNow() - rs.startedAt) / 1000);

function seekTo(t: number) {
  if (Math.abs(pl.currentTime - t) < 0.05) return;
  lastSeek = Date.now();
  void pl.seekTo(Math.max(0, t));
}

function whenBuffered() {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const check = () => (pl.isLoaded && !pl.isBuffering) || Date.now() - start > 8000 ? resolve() : setTimeout(check, 150);
    check();
  });
}

async function syncRoom() {
  const rs = room;
  if (!rs) return;
  clearTimeout(startTimer);
  if (!rs.queue[rs.index]) return pl.pause();

  if (rs.paused) {
    pl.pause();
    pl.playbackRate = 1;
    if (Math.abs(pl.currentTime - rs.position) > 0.3) seekTo(rs.position);
    return;
  }
  if (rs.waiting) {
    pl.pause();
    pl.playbackRate = 1;
    seekTo(rs.position);
    await whenBuffered();
    if (rs === room && readySent !== rs.seq) {
      readySent = rs.seq;
      sendReady?.(rs.seq);
    }
    return;
  }
  const wait = rs.startedAt + rs.position * 1000 - serverNow();
  if (wait > 15) {
    pl.pause();
    seekTo(rs.position);
    startTimer = setTimeout(syncRoom, wait);
    return;
  }
  if (Math.abs(pl.currentTime - target(rs)) > 0.25) seekTo(target(rs));
  pl.playbackRate = 1;
  if (!pl.playing) pl.play();
}

setInterval(() => {
  const rs = room;
  if (!rs || rs.paused || rs.waiting || !pl?.playing || pl.isBuffering || Date.now() - lastSeek < 2500) return;
  const t = target(rs);
  if (t < 0) return;
  const drift = pl.currentTime - t;
  if (Math.abs(drift) > 0.6) {
    seekTo(t + 0.12);
    pl.playbackRate = 1;
  } else if (Math.abs(drift) > 0.03) pl.playbackRate = 1 - Math.max(-0.05, Math.min(0.05, drift * 0.3));
  else pl.playbackRate = 1;
}, 500);

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { api, getJSON, timedFetch, conn } from './server';
import { createStore } from './store';
import type { Playlist, Track } from './types';
import { toast } from './ui';

export const LIKED = '00000000-0000-4000-8000-00000000117e';
const SONGS = `${FS.documentDirectory}songs/`;

export const library = createStore({
  playlists: [] as Playlist[],
  downloads: {} as Record<string, Track>,
  progress: {} as Record<string, number>,
  group: [] as Playlist[],
});

const save = () => {
  const { playlists, downloads } = library.get();
  AsyncStorage.multiSet([
    ['sunaan:playlists', JSON.stringify(playlists)],
    ['sunaan:downloads', JSON.stringify(downloads)],
  ]).catch(() => {});
};

export async function loadLibrary() {
  try {
    const [[, p], [, d]] = await AsyncStorage.multiGet(['sunaan:playlists', 'sunaan:downloads']);
    library.set({ playlists: JSON.parse(p || '[]'), downloads: JSON.parse(d || '{}') });
  } catch {}
  await FS.makeDirectoryAsync(SONGS, { intermediates: true }).catch(() => {});
}

// Downloaded songs live in the app's own storage and play with no internet.
export const localUri = (id: string) => (library.get().downloads[id] ? `${SONGS}${id}.m4a` : null);

function setProgress(id: string, v: number | null) {
  const progress = { ...library.get().progress };
  if (v == null) delete progress[id];
  else progress[id] = v;
  library.set({ progress });
}

let chain: Promise<unknown> = Promise.resolve();

export function download(t: Track) {
  const { downloads, progress } = library.get();
  if (downloads[t.id] || progress[t.id] != null) return;
  setProgress(t.id, 0);
  chain = chain.then(async () => {
    const target = `${SONGS}${t.id}.m4a`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const job = FS.createDownloadResumable(api(`/api/stream/${t.id}`), target, {}, (p) => {
          if (p.totalBytesExpectedToWrite > 0) setProgress(t.id, p.totalBytesWritten / p.totalBytesExpectedToWrite);
        });
        const res = await job.downloadAsync();
        if (!res || res.status !== 200) throw new Error(`HTTP ${res?.status}`);
        library.set({ downloads: { ...library.get().downloads, [t.id]: t } });
        save();
        setProgress(t.id, null);
        toast(`Downloaded ${t.title}`);
        return;
      } catch {
        await FS.deleteAsync(target, { idempotent: true }).catch(() => {});
      }
    }
    setProgress(t.id, null);
    toast(`Download failed: ${t.title}`);
  });
}

export async function removeDownload(id: string) {
  await FS.deleteAsync(`${SONGS}${id}.m4a`, { idempotent: true }).catch(() => {});
  const downloads = { ...library.get().downloads };
  delete downloads[id];
  library.set({ downloads });
  save();
}

function savePlaylist(p: Playlist) {
  const list = library.get().playlists;
  const i = list.findIndex((x) => x.id === p.id);
  library.set({ playlists: i < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x)) });
  save();
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export function createPlaylist(name: string, tracks: Track[] = []) {
  const p: Playlist = { id: uuid(), name: name.trim() || 'Playlist', tracks, created: Date.now() };
  savePlaylist(p);
  return p;
}

export const renamePlaylist = (p: Playlist, name: string) => savePlaylist({ ...p, name: name.trim() || p.name });
export const addToPlaylist = (p: Playlist, t: Track) =>
  !p.tracks.some((x) => x.id === t.id) && savePlaylist({ ...p, tracks: [...p.tracks, t] });
export const removeFromPlaylist = (p: Playlist, index: number) =>
  savePlaylist({ ...p, tracks: p.tracks.filter((_, i) => i !== index) });
export function removePlaylist(id: string) {
  library.set({ playlists: library.get().playlists.filter((p) => p.id !== id) });
  save();
}

export function useLiked(id: string) {
  return library.use().playlists.find((p) => p.id === LIKED)?.tracks.some((t) => t.id === id) ?? false;
}

export function toggleLike(t: Track) {
  const p = library.get().playlists.find((x) => x.id === LIKED) ?? { id: LIKED, name: 'Liked', tracks: [], created: 0 };
  const has = p.tracks.some((x) => x.id === t.id);
  savePlaylist({ ...p, tracks: has ? p.tracks.filter((x) => x.id !== t.id) : [t, ...p.tracks] });
  return !has;
}

// Playlists shared with the whole group (stored in Neon by the server).
export async function loadGroup() {
  const rows = await getJSON<{ id: string; name: string; owner: string; tracks: Track[]; updated_at: string }[]>(
    '/api/group/playlists',
    [],
  );
  library.set({ group: rows.map((r) => ({ ...r, created: Date.parse(r.updated_at) })) });
}

export async function shareToGroup(p: Playlist, owner: string) {
  if (!conn.get().base) return false;
  const r = await timedFetch(api(`/api/group/playlists/${p.id}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: p.name, owner, tracks: p.tracks }),
  }).catch(() => null);
  if (r?.ok) await loadGroup();
  return Boolean(r?.ok);
}

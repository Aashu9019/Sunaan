import { createStore } from './store';
import * as db from './db';
import type { Playlist, Track } from './db';

export const library = createStore({
  playlists: [] as Playlist[],
  downloads: {} as Record<string, Track>,
  progress: {} as Record<string, number>, // id -> 0..1 while downloading
  group: [] as GroupPlaylist[],
});

export type GroupPlaylist = Playlist & { owner: string };

export async function loadGroup() {
  try {
    const res = await fetch('/api/group/playlists');
    if (!res.ok) return;
    const rows: { id: string; name: string; owner: string; tracks: Track[]; updated_at: string }[] = await res.json();
    library.set({ group: rows.map((r) => ({ ...r, created: Date.parse(r.updated_at) })) });
  } catch {}
}

export async function shareToGroup(p: Playlist) {
  const owner = localStorage.getItem('groove:name') || 'Someone';
  const res = await fetch(`/api/group/playlists/${p.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: p.name, owner, tracks: p.tracks }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await loadGroup();
}

export async function unshare(id: string) {
  await fetch(`/api/group/playlists/${id}`, { method: 'DELETE' });
  await loadGroup();
}

export async function loadLibrary() {
  const [playlists, downloads] = await Promise.all([db.allPlaylists(), db.allDownloads()]);
  library.set({
    playlists: playlists.sort((a, b) => a.created - b.created),
    downloads: Object.fromEntries(downloads.map((t) => [t.id, t])),
  });
}

function setProgress(id: string, v: number | null) {
  const progress = { ...library.get().progress };
  if (v == null) delete progress[id];
  else progress[id] = v;
  library.set({ progress });
}

let queue: Promise<void> = Promise.resolve();

// Downloads run one at a time so "download all" doesn't hammer the server.
export function download(t: Track) {
  const { downloads, progress } = library.get();
  if (downloads[t.id] || progress[t.id] != null) return;
  setProgress(t.id, 0);
  navigator.storage?.persist?.();
  queue = queue.then(() => fetchTrack(t)).catch((e) => console.error('download failed', t.id, e));
}

async function fetchTrack(t: Track) {
  try {
    const res = await fetch(`/api/stream/${t.id}`);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) setProgress(t.id, got / total);
    }
    const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mp4' });
    await db.putDownload(t, blob);
    library.set({ downloads: { ...library.get().downloads, [t.id]: t } });
  } finally {
    setProgress(t.id, null);
  }
}

export async function removeDownload(id: string) {
  await db.deleteDownload(id);
  const downloads = { ...library.get().downloads };
  delete downloads[id];
  library.set({ downloads });
}

async function savePlaylist(p: Playlist) {
  await db.putPlaylist(p);
  const list = library.get().playlists;
  const i = list.findIndex((x) => x.id === p.id);
  library.set({ playlists: i < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x)) });
}

export async function createPlaylist(name: string, tracks: Track[] = []) {
  const p: Playlist = { id: crypto.randomUUID(), name: name.trim() || 'Playlist', tracks, created: Date.now() };
  await savePlaylist(p);
  return p;
}

export async function renamePlaylist(p: Playlist, name: string) {
  await savePlaylist({ ...p, name: name.trim() || p.name });
}

export async function addToPlaylist(p: Playlist, t: Track) {
  if (p.tracks.some((x) => x.id === t.id)) return;
  await savePlaylist({ ...p, tracks: [...p.tracks, t] });
}

export async function removeFromPlaylist(p: Playlist, index: number) {
  await savePlaylist({ ...p, tracks: p.tracks.filter((_, i) => i !== index) });
}

export async function removePlaylist(id: string) {
  await db.deletePlaylist(id);
  library.set({ playlists: library.get().playlists.filter((p) => p.id !== id) });
}

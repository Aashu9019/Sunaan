export type Track = { id: string; title: string; artist: string; duration: number; thumb: string; art?: string };
export type Playlist = { id: string; name: string; tracks: Track[]; created: number };

let dbp: Promise<IDBDatabase> | null = null;

function open() {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('groove', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('audio'); // id -> Blob
      d.createObjectStore('downloads'); // id -> Track
      d.createObjectStore('playlists', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  return req((await store('audio')).get(id));
}

export async function putDownload(t: Track, blob: Blob) {
  const tx = (await open()).transaction(['audio', 'downloads'], 'readwrite');
  tx.objectStore('audio').put(blob, t.id);
  tx.objectStore('downloads').put(t, t.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDownload(id: string) {
  const tx = (await open()).transaction(['audio', 'downloads'], 'readwrite');
  tx.objectStore('audio').delete(id);
  tx.objectStore('downloads').delete(id);
}

export async function allDownloads(): Promise<Track[]> {
  return req((await store('downloads')).getAll());
}

export async function allPlaylists(): Promise<Playlist[]> {
  return req((await store('playlists')).getAll());
}

export async function putPlaylist(p: Playlist) {
  await req((await store('playlists', 'readwrite')).put(p));
}

export async function deletePlaylist(id: string) {
  await req((await store('playlists', 'readwrite')).delete(id));
}

import type { Track } from './db';

// Home page rows. Each one is just a YouTube search, cached for a few hours.
export const SHELVES = [
  { title: 'Trending', q: 'new hit songs 2026 official music video' },
  { title: 'Chill', q: 'chill pop songs official audio' },
  { title: 'Hindi', q: 'latest hindi songs 2026 audio' },
  { title: 'Nepali', q: 'latest nepali songs 2026' },
  { title: 'Throwback', q: '2000s hits official audio' },
];

const TTL = 6 * 3600e3;

export async function fetchShelf(q: string): Promise<Track[]> {
  const key = `groove:shelf:${q}`;
  let cached: { at: number; items: Track[] } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {}
  if (cached && Date.now() - cached.at < TTL) return cached.items;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error();
    const items: Track[] = (await res.json()).slice(0, 15);
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), items }));
    } catch {}
    return items;
  } catch {
    return cached?.items ?? []; // stale beats empty, especially offline
  }
}

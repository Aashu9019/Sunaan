export type Track = { id: string; title: string; artist: string; duration: number; thumb: string; art?: string };
export type Playlist = { id: string; name: string; tracks: Track[]; created: number; owner?: string };

export const artOf = (t: Track) => t.art ?? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`;

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

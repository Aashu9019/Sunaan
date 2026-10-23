import { createStore } from './store';
import type { Playlist, Track } from './db';

export type SheetCtx = { track: Track; playlist?: Playlist; index?: number };

export const ui = createStore({
  sheet: null as SheetCtx | null,
  toast: null as string | null,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  clearTimeout(toastTimer);
  ui.set({ toast: msg });
  toastTimer = setTimeout(() => ui.set({ toast: null }), 2200);
}

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export const haptic = () => navigator.vibrate?.(8);

export const art =(id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

import * as Haptics from 'expo-haptics';
import { createStore } from './store';
import type { Playlist, Track } from './types';

export type SheetCtx = { track: Track; playlist?: Playlist; index?: number };

export const ui = createStore({
  sheet: null as SheetCtx | null,
  toast: null as string | null,
  playerOpen: false,
  tab: 'home' as 'home' | 'search' | 'library' | 'room',
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  clearTimeout(toastTimer);
  ui.set({ toast: msg });
  toastTimer = setTimeout(() => ui.set({ toast: null }), 2200);
}

export const tick = () => Haptics.selectionAsync().catch(() => {});
export const thump = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

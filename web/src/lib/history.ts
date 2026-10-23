import { createStore } from './store';
import type { Track } from './db';

const KEY = 'groove:history';

const load = (): Track[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
};

export const history = createStore({ recent: load() });

export function pushHistory(t: Track) {
  const recent = [t, ...history.get().recent.filter((x) => x.id !== t.id)].slice(0, 30);
  history.set({ recent });
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {}
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from './store';
import type { Track } from './types';

export const history = createStore({ recent: [] as Track[] });

export async function loadHistory() {
  try {
    history.set({ recent: JSON.parse((await AsyncStorage.getItem('sunaan:history')) || '[]') });
  } catch {}
}

export function pushHistory(t: Track) {
  const recent = [t, ...history.get().recent.filter((x) => x.id !== t.id)].slice(0, 30);
  history.set({ recent });
  AsyncStorage.setItem('sunaan:history', JSON.stringify(recent)).catch(() => {});
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from './store';

// The music server runs on a PC behind a tunnel whose link changes on restart.
// The PC reports its current link to this always-on address, and the app looks it up.
export const LOOKUP = 'https://groove-qcee.onrender.com';

type Status = 'init' | 'finding' | 'ok' | 'offline' | 'locked';
export const conn = createStore({ base: '', token: '', status: 'init' as Status });

export function timedFetch(url: string, init: RequestInit = {}, ms = 8000) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(id));
}

export const api = (path: string) => {
  const { base, token } = conn.get();
  return `${base}${path}${token ? `${path.includes('?') ? '&' : '?'}t=${token}` : ''}`;
};

export async function getJSON<T>(path: string, fallback: T, ms = 10000): Promise<T> {
  try {
    const r = await timedFetch(api(path), {}, ms);
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

const healthy = (base: string) =>
  timedFetch(`${base}/api/health`, {}, 4000)
    .then((r) => r.ok)
    .catch(() => false);

export async function initServer() {
  const [base, token] = await Promise.all([AsyncStorage.getItem('sunaan:base'), AsyncStorage.getItem('sunaan:token')]);
  conn.set({ base: base || '', token: token || '' });
  await connect();
}

let connecting: Promise<void> | null = null;
export function connect() {
  return (connecting ??= doConnect().finally(() => (connecting = null)));
}

async function doConnect() {
  let { base } = conn.get();
  if (!base || !(await healthy(base))) {
    conn.set({ status: 'finding' });
    try {
      // Render's free plan can take ~a minute to wake up
      const r = await timedFetch(`${LOOKUP}/api/where`, {}, 75000);
      const { url } = (await r.json()) as { url?: string };
      base = url && (await healthy(url)) ? url : '';
    } catch {
      base = '';
    }
  }
  if (!base) return conn.set({ status: 'offline' });
  await AsyncStorage.setItem('sunaan:base', base);
  conn.set({ base });
  const me = await timedFetch(api('/api/me')).catch(() => null);
  if (!me) return conn.set({ status: 'offline' });
  conn.set({ status: me.status === 401 ? 'locked' : 'ok' });
}

export async function unlock(key: string) {
  const r = await timedFetch(`${conn.get().base}/api/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  }).catch(() => null);
  if (!r?.ok) return false;
  const { token } = (await r.json()) as { token: string };
  await AsyncStorage.setItem('sunaan:token', token);
  conn.set({ token, status: 'ok' });
  return true;
}

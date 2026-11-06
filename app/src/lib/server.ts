import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from './store';

// The music server runs on Render. Its free plan sleeps when idle and takes ~a minute to wake.
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
  timedFetch(`${base}/api/health`, {}, 75000)
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
  const base = LOOKUP;
  conn.set({ status: 'finding' });
  if (!(await healthy(base))) return conn.set({ status: 'offline' });
  await AsyncStorage.setItem('sunaan:base', base);
  conn.set({ base });
  const me = await timedFetch(api('/api/me'), {}, 30000).catch(() => null);
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

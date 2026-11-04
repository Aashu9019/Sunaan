import { useSyncExternalStore } from 'react';

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  const get = () => state;
  const set = (patch: Partial<T>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };
  const subscribe = (f: () => void) => {
    subs.add(f);
    return () => void subs.delete(f);
  };
  const use = () => useSyncExternalStore(subscribe, get);
  return { get, set, subscribe, use };
}

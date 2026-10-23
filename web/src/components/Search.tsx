import { api } from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import type { Track } from '../lib/db';
import { dispatch } from '../lib/player';
import TrackRow from './TrackRow';
import { Icon } from './Icon';

const recentKey = 'groove:recent';
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(recentKey) || '[]');
  } catch {
    return [];
  }
};

// Results update as you type; suggestions show while the box is focused.
export default function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const input = useRef<HTMLInputElement>(null);
  const searchCtl = useRef<AbortController | null>(null);

  function remember(query: string) {
    query = query.trim();
    if (!query) return;
    const next = [query, ...recent.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 8);
    setRecent(next);
    localStorage.setItem(recentKey, JSON.stringify(next));
  }

  async function run(query: string) {
    query = query.trim();
    searchCtl.current?.abort();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctl = (searchCtl.current = new AbortController());
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/search?q=${encodeURIComponent(query)}`), { signal: ctl.signal });
      if (!res.ok) throw new Error();
      setResults(await res.json());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(navigator.onLine ? 'Search failed' : 'Offline');
    }
    if (searchCtl.current === ctl) setLoading(false);
  }

  // live results, debounced
  useEffect(() => {
    const id = setTimeout(() => run(q), 320);
    return () => clearTimeout(id);
  }, [q]);

  // suggestions, quicker debounce
  useEffect(() => {
    const query = q.trim();
    if (!query) return setSuggestions([]);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(api(`/api/suggest?q=${encodeURIComponent(query)}`), { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setSuggestions)
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [q]);

  function pick(s: string) {
    setQ(s);
    remember(s);
    setFocused(false);
    input.current?.blur();
  }

  const showSuggestions = focused && q.trim() && suggestions.length > 0;

  return (
    <section>
      <h1>Search</h1>
      <form
        className={`search glass${loading ? ' busy' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          pick(q);
        }}
      >
        <Icon name="search" size={18} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Songs, artists"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {q && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear"
            onClick={() => {
              setQ('');
              input.current?.focus();
            }}
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </form>

      {showSuggestions && (
        <div className="suggest glass">
          {suggestions.map((s) => (
            <button key={s} className="suggest-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
              <Icon name="search" size={16} />
              <span>{s}</span>
              <span
                className="fill"
                role="button"
                aria-label="Fill"
                onClick={(e) => {
                  e.stopPropagation();
                  setQ(s + ' ');
                  input.current?.focus();
                }}
              >
                ↖
              </span>
            </button>
          ))}
        </div>
      )}

      {!q.trim() && recent.length > 0 && (
        <div className="chips">
          {recent.map((r) => (
            <button key={r} className="chip glass-btn" onClick={() => pick(r)}>
              {r}
            </button>
          ))}
        </div>
      )}

      {error && <p className="muted pad">{error}</p>}

      {loading && !results.length && (
        <div className="skel-list">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skel-row">
              <div className="skel thumb" />
              <div>
                <div className="skel line" />
                <div className="skel line short" />
              </div>
            </div>
          ))}
        </div>
      )}

      {q.trim().length >= 2 && (
        <div className={loading ? 'results stale' : 'results'}>
          {results.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              onPlay={() => {
                remember(q);
                dispatch({ type: 'setQueue', queue: results.slice(i), index: 0 });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

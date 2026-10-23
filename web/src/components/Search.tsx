import { useState } from 'react';
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

export default function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(loadRecent);

  async function run(query: string) {
    query = query.trim();
    if (!query) return;
    setQ(query);
    setLoading(true);
    setError(null);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error();
      setResults(await res.json());
      const next = [query, ...recent.filter((r) => r !== query)].slice(0, 8);
      setRecent(next);
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      setError(navigator.onLine ? 'Search failed' : "Offline");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1>Search</h1>
      <form
        className="search glass"
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
      >
        <Icon name="search" size={18} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          enterKeyHint="search"
          autoCorrect="off"
        />
        {q && (
          <button type="button" className="icon-btn" aria-label="Clear" onClick={() => setQ('')}>
            <Icon name="x" size={18} />
          </button>
        )}
      </form>

      {loading && <div className="spinner" />}
      {error && <p className="muted pad">{error}</p>}

      {!loading && !results.length && !error && recent.length > 0 && (
        <div className="chips">
          {recent.map((r) => (
            <button key={r} className="chip glass-btn" onClick={() => run(r)}>
              {r}
            </button>
          ))}
        </div>
      )}

      {!loading &&
        results.map((t, i) => (
          <TrackRow key={t.id} track={t} onPlay={() => dispatch({ type: 'setQueue', queue: results.slice(i), index: 0 })} />
        ))}
    </section>
  );
}

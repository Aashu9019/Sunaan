import { useEffect, useState } from 'react';
import type { Playlist, Track } from '../lib/db';
import { history } from '../lib/history';
import { library } from '../lib/library';
import { dispatch, player } from '../lib/player';
import { SHELVES, fetchShelf } from '../lib/shelves';
import { haptic, ui } from '../lib/ui';
import { Art } from './Art';
import { Icon } from './Icon';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function Home({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const { recent } = history.use();
  const { playlists, downloads } = library.use();
  const dl = Object.values(downloads);

  const quick: { key: string; label: string; tracks: Track[]; icon?: string }[] = [
    ...(dl.length ? [{ key: 'dl', label: 'Downloads', tracks: dl, icon: 'down' }] : []),
    ...playlists.filter((p) => p.tracks.length).map((p: Playlist) => ({ key: p.id, label: p.name, tracks: p.tracks })),
    ...recent.slice(0, 6).map((t) => ({ key: 't' + t.id, label: t.title, tracks: [t] })),
  ].slice(0, 6);

  return (
    <section className="home">
      <h1 className="greet">{greeting()}</h1>

      {quick.length > 0 && (
        <div className="quick">
          {quick.map((q, i) => (
            <button
              key={q.key}
              className="quick-item glass stagger"
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => {
                haptic();
                dispatch({ type: 'setQueue', queue: q.tracks, index: 0 });
              }}
            >
              {q.icon ? (
                <span className="quick-art dl"><Icon name={q.icon} size={20} /></span>
              ) : (
                <Art id={q.tracks[0].id} className="quick-art" />
              )}
              <span className="title">{q.label}</span>
              <Eq id={q.tracks[0].id} />
            </button>
          ))}
        </div>
      )}

      {recent.length > 0 && <Shelf title="Recently played" items={recent} />}
      {SHELVES.map((s) => (
        <RemoteShelf key={s.q} title={s.title} q={s.q} />
      ))}

      {!playlists.length && !dl.length && (
        <button className="glass hint" onClick={onOpenLibrary}>
          <Icon name="library" /> <span>Make a playlist</span>
        </button>
      )}
    </section>
  );
}

function RemoteShelf({ title, q }: { title: string; q: string }) {
  const [items, setItems] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchShelf(q).then((r) => alive && setItems(r));
    return () => {
      alive = false;
    };
  }, [q]);
  if (items && !items.length) return null;
  return <Shelf title={title} items={items} />;
}

function Shelf({ title, items }: { title: string; items: Track[] | null }) {
  return (
    <div className="shelf">
      <h2>{title}</h2>
      <div className="scroller">
        {items
          ? items.map((t, i) => <Card key={t.id} track={t} i={i} onPlay={() => dispatch({ type: 'setQueue', queue: items.slice(i), index: 0 })} />)
          : Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="card">
                <div className="card-art skel" />
                <div className="skel line" />
                <div className="skel line short" />
              </div>
            ))}
      </div>
    </div>
  );
}

function Card({ track, i, onPlay }: { track: Track; i: number; onPlay: () => void }) {
  return (
    <button
      className="card stagger"
      style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
      onClick={() => {
        haptic();
        onPlay();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        ui.set({ sheet: { track } });
      }}
    >
      <span className="card-art">
        <Art id={track.id} />
        <Eq id={track.id} />
      </span>
      <span className="title">{track.title}</span>
      <span className="sub">{track.artist}</span>
    </button>
  );
}

// Little animated bars on whatever is playing.
export function Eq({ id }: { id: string }) {
  const { queue, index, playing } = player.use();
  if (queue[index]?.id !== id) return null;
  return (
    <span className={`eq${playing ? '' : ' paused'}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

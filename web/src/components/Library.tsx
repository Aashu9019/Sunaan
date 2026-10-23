import { useEffect, useState } from 'react';
import type { Playlist, Track } from '../lib/db';
import {
  createPlaylist,
  download,
  library,
  loadGroup,
  removePlaylist,
  renamePlaylist,
  shareToGroup,
  unshare,
} from '../lib/library';
import { dispatch } from '../lib/player';
import { toast } from '../lib/ui';
import TrackRow from './TrackRow';
import { Icon } from './Icon';

const DOWNLOADS = '__downloads';

const shuffled = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

type Open = { id: string; from: 'mine' | 'group' } | null;

export default function Library() {
  const { playlists, downloads, group } = library.use();
  const [open, setOpen] = useState<Open>(null);

  useEffect(() => {
    loadGroup();
  }, []);

  const dlTracks = Object.values(downloads);
  let current: Playlist | null = null;
  if (open?.id === DOWNLOADS) current = { id: DOWNLOADS, name: 'Downloads', tracks: dlTracks, created: 0 };
  else if (open?.from === 'group') current = group.find((p) => p.id === open.id) ?? null;
  else if (open) current = playlists.find((p) => p.id === open.id) ?? null;

  if (current)
    return <PlaylistView playlist={current} kind={open!.id === DOWNLOADS ? 'downloads' : open!.from} onBack={() => setOpen(null)} />;

  return (
    <section>
      <div className="head">
        <h1>Library</h1>
        <button
          className="icon-btn glass-btn"
          aria-label="New playlist"
          onClick={async () => {
            const name = prompt('Playlist name');
            if (name) setOpen({ id: (await createPlaylist(name)).id, from: 'mine' });
          }}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div className="grid">
        <button className="tile" onClick={() => setOpen({ id: DOWNLOADS, from: 'mine' })}>
          <span className="tile-art dl"><Icon name="down" size={30} /></span>
          <span className="title">Downloads</span>
          <span className="sub">{dlTracks.length}</span>
        </button>
        {playlists.map((p) => (
          <button key={p.id} className="tile" onClick={() => setOpen({ id: p.id, from: 'mine' })}>
            <Cover tracks={p.tracks} />
            <span className="title">{p.name}</span>
            <span className="sub">{p.tracks.length}</span>
          </button>
        ))}
      </div>

      {group.length > 0 && (
        <>
          <h2>Group</h2>
          <div className="grid">
            {group.map((p) => (
              <button key={p.id} className="tile" onClick={() => setOpen({ id: p.id, from: 'group' })}>
                <Cover tracks={p.tracks} />
                <span className="title">{p.name}</span>
                <span className="sub">{p.owner}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Cover({ tracks }: { tracks: Track[] }) {
  const imgs = tracks.slice(0, 4);
  if (!imgs.length) return <span className="tile-art"><Icon name="library" size={30} /></span>;
  return (
    <span className={`tile-art mosaic${imgs.length < 4 ? ' one' : ''}`}>
      {(imgs.length < 4 ? imgs.slice(0, 1) : imgs).map((t) => (
        <img key={t.id} src={t.thumb} alt="" loading="lazy" />
      ))}
    </span>
  );
}

type Kind = 'mine' | 'group' | 'downloads';

function PlaylistView({ playlist: p, kind, onBack }: { playlist: Playlist; kind: Kind; onBack: () => void }) {
  const { downloads, group } = library.use();
  const missing = p.tracks.filter((t) => !downloads[t.id]);
  const shared = group.some((g) => g.id === p.id);

  return (
    <section>
      <button className="back" onClick={onBack} aria-label="Back">
        <Icon name="back" size={22} />
      </button>
      <div className="pl-hero">
        <Cover tracks={p.tracks} />
        <h1>{p.name}</h1>
      </div>

      <div className="actions">
        <button className="primary" disabled={!p.tracks.length} onClick={() => dispatch({ type: 'setQueue', queue: p.tracks, index: 0 })}>
          <Icon name="play" size={18} /> Play
        </button>
        <button className="glass-btn icon-btn" aria-label="Shuffle" disabled={!p.tracks.length} onClick={() => dispatch({ type: 'setQueue', queue: shuffled(p.tracks), index: 0 })}>
          <Icon name="shuffle" size={20} />
        </button>
        {kind !== 'downloads' && (
          <button
            className="glass-btn icon-btn"
            aria-label="Download all"
            disabled={!missing.length}
            onClick={() => {
              missing.forEach(download);
              toast(`Downloading ${missing.length}`);
            }}
          >
            <Icon name={missing.length ? 'down' : 'check'} size={20} />
          </button>
        )}
        {kind === 'group' && (
          <button
            className="glass-btn icon-btn"
            aria-label="Save to library"
            onClick={async () => {
              await createPlaylist(p.name, p.tracks);
              toast('Saved');
            }}
          >
            <Icon name="plus" size={20} />
          </button>
        )}
        {kind === 'mine' && (
          <>
            <button
              className={`glass-btn icon-btn${shared ? ' lit' : ''}`}
              aria-label={shared ? 'Update group copy' : 'Share with group'}
              onClick={() =>
                shareToGroup(p).then(
                  () => toast(shared ? 'Updated' : 'Shared'),
                  () => toast('Share failed'),
                )
              }
            >
              <Icon name="users" size={20} />
            </button>
            <button
              className="glass-btn icon-btn"
              aria-label="Rename"
              onClick={() => {
                const name = prompt('Rename', p.name);
                if (name) renamePlaylist(p, name);
              }}
            >
              <Icon name="edit" size={20} />
            </button>
            <button
              className="glass-btn icon-btn"
              aria-label="Delete"
              onClick={() => {
                if (confirm(`Delete "${p.name}"?`)) {
                  if (shared) unshare(p.id);
                  removePlaylist(p.id);
                  onBack();
                }
              }}
            >
              <Icon name="trash" size={20} />
            </button>
          </>
        )}
      </div>

      {p.tracks.map((t, i) => (
        <TrackRow
          key={t.id + i}
          track={t}
          playlist={kind === 'mine' ? p : undefined}
          index={i}
          onPlay={() => dispatch({ type: 'setQueue', queue: p.tracks, index: i })}
        />
      ))}
    </section>
  );
}

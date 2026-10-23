import { useState } from 'react';
import { addToPlaylist, createPlaylist, download, library, removeDownload, removeFromPlaylist, saveToDevice, toggleLike, useLiked } from '../lib/library';
import { dispatch } from '../lib/player';
import { toast, ui } from '../lib/ui';
import { Icon } from './Icon';

export default function ActionSheet() {
  const { sheet } = ui.use();
  const { playlists, downloads, progress } = library.use();
  const [picking, setPicking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const liked = useLiked(sheet?.track.id ?? '');

  if (!sheet) return null;
  const { track: t, playlist, index } = sheet;
  const close = () => {
    setLeaving(true);
    setTimeout(() => {
      setPicking(false);
      setLeaving(false);
      ui.set({ sheet: null });
    }, 220);
  };
  const act = (fn: () => unknown, msg?: string) => () => {
    fn();
    if (msg) toast(msg);
    close();
  };

  return (
    <div className={`scrim${leaving ? ' out' : ''}`} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <img className="thumb" src={t.thumb} alt="" />
          <span className="meta">
            <span className="title">{t.title}</span>
            <span className="sub">{t.artist}</span>
          </span>
        </div>

        {picking ? (
          <>
            <button
              className="sheet-item"
              onClick={async () => {
                const name = prompt('New playlist name');
                if (!name) return;
                await createPlaylist(name, [t]);
                toast(`Added to ${name}`);
                close();
              }}
            >
              <Icon name="plus" /> New playlist
            </button>
            {playlists.map((p) => (
              <button key={p.id} className="sheet-item" onClick={act(() => addToPlaylist(p, t), `Added to ${p.name}`)}>
                <Icon name="library" /> {p.name}
              </button>
            ))}
          </>
        ) : (
          <>
            <button className="sheet-item" onClick={act(() => dispatch({ type: 'setQueue', queue: [t], index: 0 }))}>
              <Icon name="play" /> Play now
            </button>
            <button className="sheet-item" onClick={act(() => dispatch({ type: 'enqueue', track: t }), 'Added to queue')}>
              <Icon name="queue" /> Add to queue
            </button>
            <button className="sheet-item" onClick={act(() => toggleLike(t), liked ? 'Removed from Liked' : 'Liked')}>
              <Icon name={liked ? 'heartFill' : 'heart'} /> {liked ? 'Unlike' : 'Like'}
            </button>
            <button className="sheet-item" onClick={() => setPicking(true)}>
              <Icon name="plus" /> Add to playlist
            </button>
            {downloads[t.id] ? (
              <button className="sheet-item" onClick={act(() => removeDownload(t.id), 'Download removed')}>
                <Icon name="trash" /> Remove download
              </button>
            ) : (
              <button className="sheet-item" disabled={progress[t.id] != null} onClick={act(() => download(t), 'Downloading...')}>
                <Icon name="down" /> Download
              </button>
            )}
            <button className="sheet-item" onClick={act(() => saveToDevice(t).catch(() => toast('Save failed')), 'Saving to phone')}>
              <Icon name="save" /> Save to phone
            </button>
            {playlist && index != null && (
              <button className="sheet-item danger" onClick={act(() => removeFromPlaylist(playlist, index), 'Removed')}>
                <Icon name="x" /> Remove from {playlist.name}
              </button>
            )}
          </>
        )}
        <button className="sheet-item cancel" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

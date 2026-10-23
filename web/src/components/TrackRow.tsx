import type { Playlist, Track } from '../lib/db';
import { library } from '../lib/library';
import { player } from '../lib/player';
import { fmt, ui } from '../lib/ui';
import { Icon } from './Icon';

type Props = { track: Track; onPlay: () => void; playlist?: Playlist; index?: number };

export default function TrackRow({ track, onPlay, playlist, index }: Props) {
  const { downloads, progress } = library.use();
  const { queue, index: cur } = player.use();
  const active = queue[cur]?.id === track.id;
  const p = progress[track.id];

  return (
    <div className={`row${active ? ' active' : ''}`}>
      <button className="row-main" onClick={onPlay}>
        <img className="thumb" src={track.thumb} alt="" loading="lazy" />
        <span className="meta">
          <span className="title">{track.title}</span>
          <span className="sub">
            {downloads[track.id] && <span className="dl-dot" title="Downloaded" />}
            {p != null && <span className="dl-pct">{Math.round(p * 100)}%</span>}
            {track.artist} · {fmt(track.duration)}
          </span>
        </span>
      </button>
      <button className="icon-btn" aria-label="More" onClick={() => ui.set({ sheet: { track, playlist, index } })}>
        <Icon name="more" />
      </button>
    </div>
  );
}

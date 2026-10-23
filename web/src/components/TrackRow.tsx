import type { Playlist, Track } from '../lib/db';
import { library } from '../lib/library';
import { player } from '../lib/player';
import { fmt, haptic, ui } from '../lib/ui';
import { Eq } from './Home';
import { Icon } from './Icon';

type Props = { track: Track; onPlay: () => void; playlist?: Playlist; index?: number };

export default function TrackRow({ track, onPlay, playlist, index }: Props) {
  const { downloads, progress } = library.use();
  const { queue, index: cur } = player.use();
  const active = queue[cur]?.id === track.id;
  const p = progress[track.id];

  return (
    <div className={`row stagger${active ? ' active' : ''}`} style={{ '--i': Math.min(index ?? 0, 12) } as React.CSSProperties}>
      <button
        className="row-main"
        onClick={() => {
          haptic();
          onPlay();
        }}
      >
        <span className="thumb-wrap">
          <img className="thumb" src={track.thumb} alt="" loading="lazy" />
          {p != null && (
            <svg className="ring" viewBox="0 0 36 36" aria-hidden>
              <circle cx="18" cy="18" r="15" pathLength="1" style={{ strokeDashoffset: 1 - p }} />
            </svg>
          )}
        </span>
        <span className="meta">
          <span className="title">{track.title}</span>
          <span className="sub">
            {downloads[track.id] && <span className="dl-dot" />}
            {track.artist} · {fmt(track.duration)}
          </span>
        </span>
        <Eq id={track.id} />
      </button>
      <button className="icon-btn dim" aria-label="More" onClick={() => ui.set({ sheet: { track, playlist, index } })}>
        <Icon name="more" />
      </button>
    </div>
  );
}

import { useState } from 'react';
import { dispatch, player, tapToPlay } from '../lib/player';
import { roomStore } from '../lib/room';
import { art, fmt, ui } from '../lib/ui';
import { Icon } from './Icon';

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { queue, index, playing, time, duration, buffering, needsTap, error } = player.use();
  const t = queue[index];
  if (!t) return null;

  return (
    <div className="mini">
      <div className="mini-progress" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
      <button className="row-main" onClick={onOpen}>
        <img className="thumb" src={t.thumb} alt="" />
        <span className="meta">
          <span className="title">{t.title}</span>
          <span className={`sub${error ? ' err' : ''}`}>{error ?? t.artist}</span>
        </span>
      </button>
      {needsTap ? (
        <button className="tap" onClick={tapToPlay}>Play</button>
      ) : (
        <>
          <button className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => dispatch({ type: playing ? 'pause' : 'play' })}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button className="icon-btn" aria-label="Next" onClick={() => dispatch({ type: 'next' })}>
            <Icon name="next" size={20} />
          </button>
        </>
      )}
    </div>
  );
}

export function FullPlayer({ onClose }: { onClose: () => void }) {
  const { queue, index, playing, time, duration, buffering, needsTap, error } = player.use();
  const { code, members } = roomStore.use();
  const [scrub, setScrub] = useState<number | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const t = queue[index];
  if (!t) return null;

  const shown = scrub ?? time;

  return (
    <div className="full">
      <div className="full-top">
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="chevron" />
        </button>
        {code ? <span className="room-chip glass-btn">{code} · {members.length}</span> : <span />}
        <button className="icon-btn" aria-label="More" onClick={() => ui.set({ sheet: { track: t } })}>
          <Icon name="more" />
        </button>
      </div>

      {showQueue ? (
        <div className="queue">
          {queue.map((q, i) => (
            <div key={q.id + i} className={`row${i === index ? ' active' : ''}`}>
              <button className="row-main" onClick={() => dispatch({ type: 'playIndex', index: i })}>
                <img className="thumb" src={q.thumb} alt="" loading="lazy" />
                <span className="meta">
                  <span className="title">{q.title}</span>
                  <span className="sub">{q.artist}</span>
                </span>
              </button>
              <button className="icon-btn" aria-label="Remove" onClick={() => dispatch({ type: 'remove', index: i })}>
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="art-wrap">
          <img
            className={`art${playing ? ' playing' : ''}`}
            src={art(t.id)}
            onError={(e) => ((e.target as HTMLImageElement).src = t.thumb)}
            alt=""
          />
        </div>
      )}

      <div className="full-meta">
        <div className="title big">{t.title}</div>
        <div className={`sub${error ? ' err' : ''}`}>{error ?? t.artist}</div>
      </div>

      <input
        className="seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(shown, duration || 1)}
        style={{ '--p': `${duration ? (shown / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub != null) dispatch({ type: 'seek', time: scrub });
          setScrub(null);
        }}
        onKeyUp={() => {
          if (scrub != null) dispatch({ type: 'seek', time: scrub });
          setScrub(null);
        }}
      />
      <div className="times">
        <span>{fmt(shown)}</span>
        <span>{fmt(duration)}</span>
      </div>

      <div className="controls">
        <button className="icon-btn" aria-label="Queue" onClick={() => setShowQueue((v) => !v)} style={{ opacity: showQueue ? 1 : 0.6 }}>
          <Icon name="queue" />
        </button>
        <button className="icon-btn" aria-label="Previous" onClick={() => dispatch({ type: 'prev' })}>
          <Icon name="prev" size={30} />
        </button>
        {needsTap ? (
          <button className="play-big" onClick={tapToPlay} aria-label="Play">
            <Icon name="play" size={34} />
          </button>
        ) : (
          <button className="play-big" aria-label={playing ? 'Pause' : 'Play'} onClick={() => dispatch({ type: playing ? 'pause' : 'play' })}>
            <Icon name={playing ? 'pause' : 'play'} size={34} />
          </button>
        )}
        <button className="icon-btn" aria-label="Next" onClick={() => dispatch({ type: 'next' })}>
          <Icon name="next" size={30} />
        </button>
        <span style={{ width: 44 }} />
      </div>
    </div>
  );
}

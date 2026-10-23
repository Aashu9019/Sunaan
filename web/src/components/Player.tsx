import { useRef, useState } from 'react';
import { cycleRepeat, dispatch, player, tapToPlay, toggleShuffle } from '../lib/player';
import { toggleLike, useLiked } from '../lib/library';
import type { Track } from '../lib/db';
import { roomStore } from '../lib/room';
import { fmt, haptic, ui } from '../lib/ui';
import { Art } from './Art';
import { Eq } from './Home';
import { Icon } from './Icon';

const press = (fn: () => void) => () => {
  haptic();
  fn();
};

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { queue, index, playing, time, duration, buffering, needsTap, error } = player.use();
  const t = queue[index];
  if (!t) return null;

  return (
    <div className="mini">
      <div className={`mini-progress${buffering ? ' buffering' : ''}`} style={{ transform: `scaleX(${duration ? time / duration : 0})` }} />
      <button className="row-main" onClick={onOpen}>
        <span className="mini-art">
          <Art key={t.id} id={t.id} className="thumb" />
        </span>
        <span className="meta" key={t.id}>
          <span className="title slide-in">{t.title}</span>
          <span className={`sub${error ? ' err' : ''}`}>{error ?? t.artist}</span>
        </span>
      </button>
      {needsTap ? (
        <button className="tap" onClick={tapToPlay}>Play</button>
      ) : (
        <>
          <button className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={press(() => dispatch({ type: playing ? 'pause' : 'play' }))}>
            <span className="morph" key={String(playing)}><Icon name={playing ? 'pause' : 'play'} /></span>
          </button>
          <button className="icon-btn" aria-label="Next" onClick={press(() => dispatch({ type: 'next' }))}>
            <Icon name="next" size={20} />
          </button>
        </>
      )}
    </div>
  );
}

export function FullPlayer({ onClose }: { onClose: () => void }) {
  const { queue, index, playing, time, duration, buffering, needsTap, error, repeat, shuffle } = player.use();
  const { code, members } = roomStore.use();
  const [scrub, setScrub] = useState<number | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const t = queue[index];

  function close() {
    const el = sheet.current;
    if (!el) return onClose();
    el.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 1, 1)';
    el.style.transform = 'translateY(100%)';
    setTimeout(onClose, 300);
  }

  // Swipe down anywhere on the artwork/header to dismiss, like Apple Music.
  const dragHandlers = {
    onPointerDown(e: React.PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
      sheet.current!.style.transition = 'none';
    },
    onPointerMove(e: React.PointerEvent) {
      const d = drag.current;
      if (!d) return;
      d.dy = Math.max(0, e.clientY - d.y);
      if (d.dy > 6) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      // rubber-band: moves less the further you pull
      sheet.current!.style.transform = `translateY(${d.dy * 0.9}px) scale(${1 - Math.min(d.dy, 400) / 4000})`;
    },
    onPointerUp() {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const v = d.dy / (performance.now() - d.t);
      if (d.dy > 140 || (v > 0.5 && d.dy > 40)) return close();
      const el = sheet.current!;
      el.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.9, 0.25, 1.15)';
      el.style.transform = '';
    },
  };

  if (!t) return null;
  const shown = scrub ?? time;
  const commit = () => {
    if (scrub != null) dispatch({ type: 'seek', time: scrub });
    setScrub(null);
  };

  return (
    <div className="full" ref={sheet}>
      <div className="full-bg" aria-hidden>
        <Art key={t.id} id={t.id} hi />
      </div>
      <div className="full-top" {...dragHandlers}>
        <span className="grabber" />
        <button className="icon-btn" aria-label="Close" onClick={close}>
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
            <div key={q.id + i} className={`row stagger${i === index ? ' active' : ''}`} style={{ '--i': Math.min(i, 10) } as React.CSSProperties}>
              <button className="row-main" onClick={() => dispatch({ type: 'playIndex', index: i })}>
                <img className="thumb" src={q.thumb} alt="" loading="lazy" />
                <span className="meta">
                  <span className="title">{q.title}</span>
                  <span className="sub">{q.artist}</span>
                </span>
                <Eq id={q.id} />
              </button>
              <button className="icon-btn" aria-label="Remove" onClick={() => dispatch({ type: 'remove', index: i })}>
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="art-wrap" {...dragHandlers}>
          <div className={`art${playing ? ' playing' : ''}`}>
            <Art key={t.id} id={t.id} hi />
          </div>
        </div>
      )}

      <div className="full-meta">
        <div className="meta" key={t.id}>
          <div className="title big slide-in">{t.title}</div>
          <div className={`sub slide-in d1${error ? ' err' : ''}`}>{error ?? t.artist}</div>
        </div>
        <LikeButton track={t} />
      </div>

      <input
        className={`seek${scrub != null ? ' active' : ''}${buffering ? ' buffering' : ''}`}
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(shown, duration || 1)}
        style={{ '--p': `${duration ? (shown / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <div className="times">
        <span>{fmt(shown)}</span>
        <span>-{fmt(Math.max(0, duration - shown))}</span>
      </div>

      <div className="controls">
        <button className={`icon-btn${shuffle ? ' lit' : ' dim'}`} aria-label="Shuffle" onClick={press(toggleShuffle)}>
          <Icon name="shuffle" />
        </button>
        <button className="icon-btn skip" aria-label="Previous" onClick={press(() => dispatch({ type: 'prev' }))}>
          <Icon name="prev" size={30} />
        </button>
        <button
          className="play-big"
          aria-label={playing && !needsTap ? 'Pause' : 'Play'}
          onClick={press(() => (needsTap ? tapToPlay() : dispatch({ type: playing ? 'pause' : 'play' })))}
        >
          <span className="morph" key={String(playing && !needsTap)}>
            <Icon name={playing && !needsTap ? 'pause' : 'play'} size={34} />
          </span>
        </button>
        <button className="icon-btn skip" aria-label="Next" onClick={press(() => dispatch({ type: 'next' }))}>
          <Icon name="next" size={30} />
        </button>
        <button className={`icon-btn repeat${repeat !== 'off' ? ' lit' : ' dim'}`} aria-label={`Repeat ${repeat}`} onClick={press(cycleRepeat)}>
          <Icon name="repeat" />
          {repeat === 'one' && <span className="one">1</span>}
        </button>
      </div>

      <div className="extras">
        <button className={`icon-btn${showQueue ? ' lit' : ' dim'}`} aria-label="Queue" onClick={press(() => setShowQueue((v) => !v))}>
          <Icon name="queue" size={20} />
        </button>
      </div>
    </div>
  );
}

function LikeButton({ track }: { track: Track }) {
  const liked = useLiked(track.id);
  const [pop, setPop] = useState(0);
  return (
    <button
      className={`icon-btn like${liked ? ' on' : ''}`}
      aria-label={liked ? 'Unlike' : 'Like'}
      onClick={() => {
        haptic();
        setPop((n) => n + 1);
        toggleLike(track);
      }}
    >
      <span className="morph" key={pop}>
        <Icon name={liked ? 'heartFill' : 'heart'} size={26} />
      </span>
    </button>
  );
}

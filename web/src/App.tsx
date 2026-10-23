import { useEffect, useState } from 'react';
import Home from './components/Home';
import Search from './components/Search';
import Library from './components/Library';
import Room from './components/Room';
import { MiniPlayer, FullPlayer } from './components/Player';
import ActionSheet from './components/ActionSheet';
import { Icon } from './components/Icon';
import { art, haptic, ui } from './lib/ui';
import { joinRoom, roomStore } from './lib/room';
import { player } from './lib/player';

type Tab = 'home' | 'search' | 'library' | 'room';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'library', icon: 'library', label: 'Library' },
  { id: 'room', icon: 'users', label: 'Together' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [full, setFull] = useState(false);
  const [locked, setLocked] = useState(false);
  const { toast } = ui.use();
  const { code } = roomStore.use();

  useEffect(() => {
    // Offline: fetch throws, stay unlocked so downloads keep working.
    fetch('/api/me')
      .then((r) => r.status === 401 && setLocked(true))
      .catch(() => {});

    const fromUrl = new URLSearchParams(location.search).get('room');
    const name = localStorage.getItem('groove:name');
    if (fromUrl) {
      history.replaceState(null, '', '/');
      setTab('room');
      if (name) joinRoom(fromUrl, name);
      else sessionStorage.setItem('groove:pendingRoom', fromUrl);
    } else {
      const last = localStorage.getItem('groove:room');
      if (last && name) joinRoom(last, name);
    }
  }, []);

  if (locked) return <Lock />;

  return (
    <div className="app">
      <Ambient />
      <main className="content">
        <div className="pane" hidden={tab !== 'home'}><Home onOpenLibrary={() => setTab('library')} /></div>
        <div className="pane" hidden={tab !== 'search'}><Search /></div>
        <div className="pane" hidden={tab !== 'library'}><Library /></div>
        <div className="pane" hidden={tab !== 'room'}><Room /></div>
      </main>

      <div className="dock">
        <MiniPlayer onOpen={() => setFull(true)} />
        <nav className="tabs glass" style={{ '--tab': TABS.findIndex((x) => x.id === tab) } as React.CSSProperties}>
          <span className="tab-pill" aria-hidden />
          {TABS.map((x) => (
            <button
              key={x.id}
              className={tab === x.id ? 'on' : ''}
              aria-label={x.label}
              onClick={() => {
                haptic();
                if (tab === x.id) window.scrollTo({ top: 0, behavior: 'smooth' });
                else {
                  setTab(x.id);
                  window.scrollTo(0, 0);
                }
              }}
            >
              <Icon name={x.icon} />
              {x.id === 'room' && code && <span className="badge" />}
            </button>
          ))}
        </nav>
      </div>

      {full && <FullPlayer onClose={() => setFull(false)} />}
      <ActionSheet />
      {toast && <div className="toast glass">{toast}</div>}
    </div>
  );
}

// Blurred artwork behind everything; the glass panels pick up its colour.
function Ambient() {
  const { queue, index } = player.use();
  const t = queue[index];
  return (
    <div className="ambient" aria-hidden>
      {t && <img key={t.id} src={art(t.id)} alt="" />}
    </div>
  );
}

function Lock() {
  const [key, setKey] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="app lock">
      <div className="ambient" aria-hidden />
      <form
        className="glass form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await fetch('/api/unlock', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key }),
          });
          if (r.ok) location.reload();
          else setBad(true);
        }}
      >
        <img src="/icon.svg" width={64} height={64} alt="" />
        <input
          className={`field${bad ? ' bad' : ''}`}
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setBad(false);
          }}
          placeholder="Group key"
          autoFocus
        />
        <button className="primary wide" type="submit">Enter</button>
      </form>
    </div>
  );
}

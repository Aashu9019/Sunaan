import { useState } from 'react';
import { joinRoom, leaveRoom, randomCode, roomStore } from '../lib/room';
import { toast } from '../lib/ui';
import { Icon } from './Icon';

export default function Room() {
  const { code, members, connected } = roomStore.use();
  const [name, setName] = useState(() => localStorage.getItem('groove:name') || '');
  const [joinCode, setJoinCode] = useState(() => sessionStorage.getItem('groove:pendingRoom') || '');

  function go(c: string) {
    if (!name.trim()) return toast('Add your name');
    localStorage.setItem('groove:name', name.trim());
    sessionStorage.removeItem('groove:pendingRoom');
    joinRoom(c, name.trim());
  }

  async function share() {
    const url = `${location.origin}/?room=${code}`;
    if (navigator.share) await navigator.share({ title: 'Groove', url }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      toast('Link copied');
    }
  }

  if (code) {
    return (
      <section>
        <h1>Together</h1>
        <div className="glass room-code">
          <span className={`dot${connected ? ' ok' : ''}`} />
          <span className="code">{code}</span>
          <div className="actions center">
            <button className="primary" onClick={share}>
              <Icon name="share" size={18} /> Invite
            </button>
            <button className="glass-btn pill" onClick={leaveRoom}>Leave</button>
          </div>
        </div>
        <div className="members">
          {members.map((m, i) => (
            <div key={i} className="member">
              <span className="avatar">{m.slice(0, 1).toUpperCase()}</span>
              <span className="small">{m}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>Together</h1>
      <div className="glass form">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={24} />
        <button className="primary wide" onClick={() => go(randomCode())}>
          Start a room
        </button>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (joinCode.trim()) go(joinCode);
          }}
        >
          <input
            className="field"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={8}
            autoCapitalize="characters"
          />
          <button className="glass-btn pill" type="submit">Join</button>
        </form>
      </div>
    </section>
  );
}

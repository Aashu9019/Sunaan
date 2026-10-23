import { io, type Socket } from 'socket.io-client';
import { createStore } from './store';
import { applyRoom, audio, leaveRoomPlayback, player, setRemote, type RoomState } from './player';

export const roomStore = createStore({
  code: null as string | null,
  members: [] as string[],
  connected: false,
});

let socket: Socket | null = null;
let offset = 0; // serverTime - localTime
let clockTimer: ReturnType<typeof setInterval> | undefined;

const serverNow = () => Date.now() + offset;

// NTP-style: keep the sample with the lowest round trip.
async function syncClock(s: Socket) {
  let best = Infinity;
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const server: number = await s.timeout(3000).emitWithAck('time').catch(() => NaN);
    const t1 = Date.now();
    if (Number.isNaN(server)) continue;
    if (t1 - t0 < best) {
      best = t1 - t0;
      offset = server + (t1 - t0) / 2 - t1;
    }
  }
}

export function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
}

export function joinRoom(code: string, name: string) {
  leaveRoom();
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  const s = io({ transports: ['websocket', 'polling'] });
  socket = s;
  roomStore.set({ code, members: [], connected: false });
  localStorage.setItem('groove:room', code);

  s.on('connect', async () => {
    await syncClock(s);
    const { queue, index } = player.get();
    s.emit('join', { code, name, seed: { queue, index, position: audio.currentTime } });
    roomStore.set({ connected: true });
  });
  s.on('disconnect', () => roomStore.set({ connected: false }));
  s.on('state', (rs: RoomState) => {
    roomStore.set({ members: rs.members });
    applyRoom(rs, serverNow);
  });

  setRemote((a) => s.emit('control', a));
  clockTimer = setInterval(() => s.connected && syncClock(s), 30000);
}

export function leaveRoom() {
  if (!socket) return;
  clearInterval(clockTimer);
  socket.emit('leave');
  socket.disconnect();
  socket = null;
  setRemote(null);
  leaveRoomPlayback();
  localStorage.removeItem('groove:room');
  roomStore.set({ code: null, members: [], connected: false });
}

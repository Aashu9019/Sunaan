// Token from the server, attached to every API call so playback works even where
// cookies aren't sent (iPhone audio player, home-screen app).
let token = '';
try {
  token = localStorage.getItem('groove:t') || '';
} catch {}

export function setToken(t: string) {
  token = t || '';
  try {
    localStorage.setItem('groove:t', token);
  } catch {}
}

export const getToken = () => token;

export const api = (path: string) => (token ? `${path}${path.includes('?') ? '&' : '?'}t=${token}` : path);

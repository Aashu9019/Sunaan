// One command to put Sunaan online from this PC: starts the server and a Cloudflare quick tunnel,
// then prints a public https link (also saved to share-url.txt). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '4747';
const exe = path.join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

if (!fs.existsSync(exe)) {
  const asset = { win32: 'cloudflared-windows-amd64.exe', linux: 'cloudflared-linux-amd64' }[process.platform];
  if (!asset) throw new Error('Install cloudflared and put it in tools/');
  console.log('Downloading cloudflared...');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`);
  fs.writeFileSync(exe, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
}

// Restarts on crash or code reload without dropping the tunnel, so the link stays the same.
let server;
let stopping = false;
const startServer = () => {
  server = spawn(process.execPath, ['--env-file-if-exists=../.env', 'index.js'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT },
  stdio: 'inherit',
});
  server.on('exit', () => !stopping && setTimeout(startServer, 1000));
};
startServer();

// Quick tunnels sometimes die silently (network blip, sleep). Check every minute from the
// outside; after 3 misses, open a fresh tunnel and re-announce it so /go keeps working.
let tunnel;
let current = '';
const startTunnel = () => {
  current = '';
  tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]);
  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch);
  tunnel.on('exit', () => !stopping && setTimeout(startTunnel, 2000));
};
const watch = (buf) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf))?.[0];
  if (url && !current) {
    current = url;
    fs.writeFileSync(path.join(root, 'share-url.txt'), url + '\n');
    const key = /^GROUP_KEY=(.*)$/m.exec(fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '')?.[1];
    console.log(`
  Sunaan is live:  ${url}
${key ? `  Group key:       ${key}
` : ''}`);
    announce(url);
  }
};
let misses = 0;
setInterval(async () => {
  if (!current) return;
  const ok = await fetch(`${current}/api/health`, { signal: AbortSignal.timeout(15000) }).then((r) => r.status < 500, () => false);
  misses = ok ? 0 : misses + 1;
  if (misses >= 3) {
    misses = 0;
    console.log('  Tunnel stopped answering, opening a new one...');
    tunnel.kill(); // exit handler starts a new tunnel
  }
}, 60000);
startTunnel();

// Tell the Render instance where we are, so the APK and /go always find the current link.
// Retries because Render's free plan may need ~a minute to wake up.
async function announce(url) {
  const env = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
  const render = /^RENDER_URL=(.*)$/m.exec(env)?.[1]?.trim();
  const key = /^GROUP_KEY=(.*)$/m.exec(env)?.[1]?.trim();
  if (!render || !key) return;
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(`${render}/api/where`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-group-key': key },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(70000),
      });
      if (r.ok) return console.log(`  Fixed link:      ${render}/go
`);
      console.log(`  Could not register with Render (HTTP ${r.status})`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const stop = () => {
  stopping = true;
  server.kill();
  tunnel.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

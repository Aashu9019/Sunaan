// One command to put Sunaan online from this PC: starts the server and a Cloudflare quick tunnel,
// then prints a public https link (also saved to share-url.txt). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '3001';
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

const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]);
let shown = false;
const watch = (buf) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf))?.[0];
  if (url && !shown) {
    shown = true;
    fs.writeFileSync(path.join(root, 'share-url.txt'), url + '\n');
    const key = /^GROUP_KEY=(.*)$/m.exec(fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '')?.[1];
    console.log(`\n  Sunaan is live:  ${url}\n${key ? `  Group key:       ${key}\n` : ''}`);
  }
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);

const stop = () => {
  stopping = true;
  server.kill();
  tunnel.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', stop);

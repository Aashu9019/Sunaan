// Sunaan app icons: vinyl disc with an amber label, drawn without image libraries.
import fs from 'node:fs';
import zlib from 'node:zlib';
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size, { bg = true, scale = 1, mono = false } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size), mid = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid) / (mid * scale);
    let px = bg ? [7, 7, 10, 255] : [0, 0, 0, 0];
    if (d < 0.72) px = Math.floor(d * 40) % 2 ? [30, 28, 34, 255] : [22, 21, 25, 255];
    if (d < 0.3) px = [255, 181, 71, 255];
    if (d < 0.07) px = bg ? [7, 7, 10, 255] : [0, 0, 0, 0];
    if (mono && px[3]) px = [255, 255, 255, d < 0.3 || d >= 0.72 ? 255 : 120];
    raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
  }
  const h = Buffer.alloc(13); h.writeUInt32BE(size, 0); h.writeUInt32BE(size, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dir = process.argv[2];
fs.writeFileSync(`${dir}/icon.png`, png(1024));
fs.writeFileSync(`${dir}/android-icon-foreground.png`, png(1024, { bg: false, scale: 0.66 }));
fs.writeFileSync(`${dir}/android-icon-monochrome.png`, png(1024, { bg: false, scale: 0.66, mono: true }));
fs.writeFileSync(`${dir}/splash-icon.png`, png(512, { bg: false }));
fs.writeFileSync(`${dir}/favicon.png`, png(48));

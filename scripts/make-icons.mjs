// Vygeneruje PNG ikony appky bez závislostí: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Podíl bílé (0..1) v bodě [x,y] v normalizovaných souřadnicích 0..1 */
function glyph(x, y) {
  const cx = 0.5, cy = 0.44;
  const dx = x - cx, dy = y - cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx); // dolů = +PI/2
  const openBottom = Math.abs(ang - Math.PI / 2) < 0.75; // výřez dole
  if (r < 0.075) return 1; // hlava mikrofonu
  if (!openBottom && ((r > 0.15 && r < 0.2) || (r > 0.265 && r < 0.315))) return 1;
  // stojánek
  if (Math.abs(dx) < 0.045 && y > cy + 0.1 && y < 0.82) return 1;
  if (Math.hypot(dx, y - 0.82) < 0.045) return 1;
  if (Math.hypot(dx, y - (cy + 0.1)) < 0.045) return 1;
  return 0;
}

function render(size) {
  const ss = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let w = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) w += glyph((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
      w /= ss * ss;
      const t = (px + py) / (2 * size); // diagonální gradient
      const bg = [Math.round(0xc1 + (0x6f - 0xc1) * t), Math.round(0x6a + (0x2b - 0x6a) * t), Math.round(0xf2 + (0xd1 - 0xf2) * t)];
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] + (255 - bg[i]) * w);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size));
  console.log('public/' + name);
}

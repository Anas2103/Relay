// Draws the app icons as PNGs (no dependencies): node scripts/make-icons.mjs
// Same design as public/favicon.svg: a chat bubble on the brand color.
// "maskable" icons keep the bubble inside the central safe zone, for Android's shaped icons.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0x4f, 0x46, 0xe5];
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const t = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (s < 0 !== t < 0 && s !== 0 && t !== 0) return false;
  const d = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  return d === 0 || d < 0 === s + t <= 0;
}

/** Shapes in a 32-unit design space. `scale` shrinks the bubble toward the centre (maskable). */
function sample(u, v, { rounded, scale }) {
  const bg = rounded ? inRoundRect(u, v, 0, 0, 32, 32, 8) : true;
  if (!bg) return null;
  const x = 16 + (u - 16) / scale;
  const y = 16 + (v - 16) / scale;
  const bubble = inRoundRect(x, y, 9, 8, 23, 20, 3.5) || inTriangle(x, y, [10.5, 19], [15, 20], [10.2, 23.6]);
  return bubble ? FG : BG;
}

function icon(size, opts) {
  const SS = 4;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < SS; i++) {
      for (let j = 0; j < SS; j++) {
        const c = sample(((px + (i + 0.5) / SS) / size) * 32, ((py + (j + 0.5) / SS) / size) * 32, opts);
        if (!c) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        a += 255;
      }
    }
    const n = SS * SS;
    const cov = a / 255;
    return cov ? [Math.round(r / cov), Math.round(g / cov), Math.round(b / cov), Math.round(a / n)] : [0, 0, 0, 0];
  });
}

writeFileSync("public/icon-192.png", icon(192, { rounded: true, scale: 1 }));
writeFileSync("public/icon-512.png", icon(512, { rounded: true, scale: 1 }));
writeFileSync("public/icon-maskable-512.png", icon(512, { rounded: false, scale: 0.78 }));
writeFileSync("public/apple-touch-icon.png", icon(180, { rounded: false, scale: 0.9 }));
console.log("icons written to public/");

// Generates WebPwn Coach PNG icons (no external deps; raw PNG via zlib).
// Design: dark rounded panel, glowing cyan diamond (the ◆ brand mark).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets");
mkdirSync(OUT, { recursive: true });

const BG = [13, 23, 33];       // panel
const EDGE = [31, 111, 235];   // blue border
const DIA = [88, 166, 255];    // brand diamond
const DIA2 = [126, 231, 135];  // inner accent

function px(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size * 0.42;         // corner radius region
  const set = (x, y, rgb, a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded-square mask via superellipse-ish distance.
      const dx = Math.abs(x - c), dy = Math.abs(y - c);
      const rad = Math.max(dx, dy);
      if (rad > c) { set(x, y, BG, 0); continue; }
      let color = BG;
      if (rad > c - Math.max(1, size * 0.09)) color = EDGE; // border ring
      // Diamond (|dx|+|dy| <= r)
      const man = dx + dy;
      if (man <= r * 0.55) color = DIA2;
      else if (man <= r) color = DIA;
      set(x, y, color, 255);
    }
  }
  return buf;
}

function png(size) {
  const raw = px(size);
  // Add filter byte (0) per scanline.
  const stride = size * 4;
  const filtered = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(filtered, { level: 9 });

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// CRC32
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const s of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon${s}.png`), png(s));
  console.log("wrote icon" + s + ".png");
}

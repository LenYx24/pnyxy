// Generates the extension's 16/48/128 px toolbar icons as plain PNGs, using
// only Node's built-in "fs" and "zlib" (no npm dependencies, no build step
// for the extension itself). Chrome does not accept SVG for extension
// icons, so this stands in for a real image tool.
//
// The mark is a blocky simplification of the app's "P" logo (see
// public/favicon.svg): a stem, a loop, and a triangular notch cut where
// they meet, in the app's accent color (#5fb3c6). Each pixel is
// supersampled on a 4x4 grid so the diagonal notch edge isn't too jagged
// at 16 px.
//
// Run: node icons/generate-icons.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const ACCENT = [0x5f, 0xb3, 0xc6]; // #5fb3c6
const SIZES = [16, 48, 128];
const SUPERSAMPLE = 4;

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- shape: a blocky "P", normalized to a 0..1 square ---------------------

function insideMark(u, v) {
  const inStem = u >= 0.2 && u <= 0.39 && v >= 0.12 && v <= 0.88;
  const inLoop = u >= 0.39 && u <= 0.62 && v >= 0.12 && v <= 0.5;
  if (!inStem && !inLoop) return false;

  // Triangular notch cut where the stem meets the loop, echoing the
  // shadow cut in the real logo's path.
  const notchX0 = 0.2;
  const notchX1 = 0.55;
  const notchY0 = 0.39;
  const notchY1 = 0.56;
  if (u >= notchX0 && u <= notchX1 && v >= notchY0 && v <= notchY1) {
    const t = (u - notchX0) / (notchX1 - notchX0);
    const lineV = notchY0 + t * (notchY1 - notchY0);
    if (v >= lineV) return false;
  }
  return true;
}

// --- pixel buffer -----------------------------------------------------------

function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
          if (insideMark(u, v)) hits++;
        }
      }
      const coverage = hits / (SUPERSAMPLE * SUPERSAMPLE);
      const i = (y * size + x) * 4;
      buf[i] = ACCENT[0];
      buf[i + 1] = ACCENT[1];
      buf[i + 2] = ACCENT[2];
      buf[i + 3] = Math.round(coverage * 255);
    }
  }
  return buf;
}

// --- minimal PNG encoder (8-bit RGBA, no filtering, no interlace) ---------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const png = encodePNG(size, renderRGBA(size));
  const outPath = join(__dirname, `icon${size}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

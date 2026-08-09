/**
 * pngPixels.js — dependency-free PNG decode + pixel-diff for the executed-GL e2e lane
 * (Report 11.0 R11-14, 2026-08-09).
 *
 * WHY HAND-ROLLED: the repo carries no pngjs/pixelmatch, and the e2e lane must not grow a
 * dependency for one assertion. Playwright screenshots are 8-bit, non-interlaced PNGs (colour
 * type 6 RGBA or 2 RGB) — the narrow decode below covers exactly that and REFUSES anything
 * else rather than mis-reading it (a wrong decode would grade the decoder, not the map).
 * Node's zlib does the real work; this file only walks chunks and un-filters scanlines.
 */
const zlib = require('zlib');

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colourType !== 6 && colourType !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG shape (depth ${bitDepth}, colour ${colourType}, interlace ${interlace}) — refuse, never guess`);
  }
  const bpp = colourType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rp++];
      const a = x >= bpp ? row[x - bpp] : 0;                 // left
      const b = prev ? prev[x] : 0;                          // up
      const c = x >= bpp && prev ? prev[x - bpp] : 0;        // up-left
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: {                                            // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      row[x] = val & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

/** Fraction of sampled pixels whose RGB sum-abs-delta exceeds `threshold` (default 30 of 765).
 *  Stride-samples every `step`th pixel — plenty for a whole-field change signal. REFUSES on
 *  dimension mismatch (a resized viewport mid-test would read as a fake 100% change). */
function diffFraction(pngA, pngB, { threshold = 30, step = 3 } = {}) {
  const A = decodePng(pngA), B = decodePng(pngB);
  if (A.width !== B.width || A.height !== B.height) {
    throw new Error(`dimension mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  }
  let sampled = 0, changed = 0;
  const n = A.width * A.height;
  for (let i = 0; i < n; i += step) {
    const pa = i * A.bpp, pb = i * B.bpp;
    const d = Math.abs(A.data[pa] - B.data[pb]) +
              Math.abs(A.data[pa + 1] - B.data[pb + 1]) +
              Math.abs(A.data[pa + 2] - B.data[pb + 2]);
    sampled++;
    if (d > threshold) changed++;
  }
  return changed / Math.max(1, sampled);
}

/** Non-blank check: fraction of sampled pixels differing from the image's mean colour. A blank
 *  (or single-colour wash) field reads ~0; any real heatmap reads well above. */
function varianceFraction(png, { threshold = 30, step = 3 } = {}) {
  const A = decodePng(png);
  const n = A.width * A.height;
  let sr = 0, sg = 0, sb = 0, count = 0;
  for (let i = 0; i < n; i += step) {
    const p = i * A.bpp;
    sr += A.data[p]; sg += A.data[p + 1]; sb += A.data[p + 2]; count++;
  }
  const mr = sr / count, mg = sg / count, mb = sb / count;
  let diverse = 0;
  for (let i = 0; i < n; i += step) {
    const p = i * A.bpp;
    const d = Math.abs(A.data[p] - mr) + Math.abs(A.data[p + 1] - mg) + Math.abs(A.data[p + 2] - mb);
    if (d > threshold) diverse++;
  }
  return diverse / Math.max(1, count);
}

module.exports = { decodePng, diffFraction, varianceFraction };

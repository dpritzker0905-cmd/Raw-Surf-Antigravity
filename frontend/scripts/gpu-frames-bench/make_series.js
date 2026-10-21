// GPU FRAMES BENCH: build a forecast SERIES of gzipped RSWF v1 frames (the static-frames codec, backend/services/frame_binary.py)
// for the bench to stream. Two sources:
//   --real <dir>   cycle through real gzipped frames found in <dir> (*.bin, e.g. written by publish_frame_images.py's LocalSink
//                  or frame_binary.encode_frame + gzip_frame), restamping each copy's valid time, so sizes and entropy are real;
//   (default)      a synthetic world field 181 x 83 (2 deg) quantised like the source data (0.01 m / 0.01 deg / 0.01 s),
//                  drifting storms over a fixed land mask, so a run needs no data at all.
//   node frontend/scripts/gpu-frames-bench/make_series.js --out <dir> [--n 115] [--step 3] [--real <dir>] [--cols 181 --rows 83]
// Writes <out>/f000.bin ... and <out>/index.json ({ frames: [{ path, valid_time, bytes }], cols, rows }).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};
const OUT = path.resolve(arg('out', path.join(__dirname, 'frames')));
const N = +arg('n', 115);
const STEP_H = +arg('step', 3);
const REAL = arg('real', null);
const COLS = +arg('cols', 181);
const ROWS = +arg('rows', 83);
const RUN_MS = Date.UTC(2026, 9, 20, 0, 0, 0);

const HEADER_FIXED = 72;
const DESCRIPTOR = 24;
// Python's round(): half to even (Math.round goes half up and differed from frame_binary.py on ~0.4% of bytes).
function pyRound(x) {
  const f = Math.floor(x); const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Encode one frame exactly like frame_binary.encode_frame (fields 0..3, byte-shuffled u16 planes). */
function encodeFrame({ cols, rows, bounds, validMs, runMs, height, direction, period, conf }) {
  const n = cols * rows;
  const specs = [
    { id: 0, nb: 2, layout: 1, missing: 0, scale: 0.001, offset: -0.001 },
    { id: 1, nb: 2, layout: 1, missing: 0xFFFFFFFF, scale: 0.01, offset: 0 },
    { id: 2, nb: 2, layout: 1, missing: 0xFFFF, scale: 0.01, offset: 0 },
    { id: 3, nb: 1, layout: 0, missing: 0xFF, scale: 1 / 254, offset: 0 },
  ];
  const headerBytes = HEADER_FIXED + DESCRIPTOR * specs.length;
  const total = headerBytes + n * (2 + 2 + 2 + 1);
  const buf = Buffer.alloc(total);
  buf.write('RSWF', 0, 'ascii');
  buf.writeUInt16LE(1, 4); buf.writeUInt16LE(1, 6); buf.writeUInt16LE(cols, 8); buf.writeUInt16LE(rows, 10);
  buf.writeUInt32LE(0b1111, 12); buf.writeUInt8(0, 16); buf.writeUInt8(0, 17); buf.writeUInt8(specs.length, 18);
  buf.writeUInt8(0, 19); buf.writeUInt32LE(headerBytes, 20);
  buf.writeDoubleLE(bounds.west, 24); buf.writeDoubleLE(bounds.south, 32); buf.writeDoubleLE(bounds.east, 40); buf.writeDoubleLE(bounds.north, 48);
  buf.writeDoubleLE(validMs / 1000, 56); buf.writeDoubleLE(runMs / 1000, 64);
  let pos = headerBytes;
  specs.forEach((s, f) => {
    const d = HEADER_FIXED + f * DESCRIPTOR;
    buf.writeUInt8(s.id, d); buf.writeUInt8(s.nb, d + 1); buf.writeUInt8(s.layout, d + 2); buf.writeUInt8(0, d + 3);
    buf.writeUInt32LE(s.missing >>> 0, d + 4); buf.writeDoubleLE(s.scale, d + 8); buf.writeDoubleLE(s.offset, d + 16);
    for (let k = 0; k < n; k++) {
      let code;
      if (s.id === 0) code = Number.isNaN(height[k]) ? 0 : Math.min(0xFFFF, pyRound(height[k] / 0.001) + 1);
      else if (s.id === 1) code = pyRound((((direction[k] % 360) + 360) % 360) / 0.01) % 36000;
      else if (s.id === 2) code = Number.isNaN(period[k]) ? 0xFFFF : Math.max(0, Math.min(0xFFFE, pyRound(period[k] / 0.01)));
      else code = Number.isNaN(conf[k]) ? 0xFF : Math.max(0, Math.min(254, pyRound(conf[k] * 254)));
      if (s.nb === 1) buf[pos + k] = code;
      else { buf[pos + k] = code & 0xFF; buf[pos + n + k] = code >> 8; }
    }
    pos += n * s.nb;
  });
  return buf;
}

// A crude but fixed land mask: continents as ellipses on the 2-deg lattice (about 30% land, like the real world frame's ~32%).
const LAND = [[-100, 45, 30, 22], [-60, -15, 16, 26], [20, 5, 22, 32], [90, 45, 50, 20], [135, -25, 18, 12], [0, -78, 180, 8], [-40, 72, 20, 10]];
function isLand(lat, lng) {
  return LAND.some(([cx, cy, rx, ry]) => ((lng - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 < 1);
}

function syntheticFrame(k, bounds) {
  const n = COLS * ROWS;
  const height = new Float64Array(n); const direction = new Float64Array(n); const period = new Float64Array(n); const conf = new Float64Array(n);
  const t = k * STEP_H;
  const storms = [[-40 + 0.6 * t, 45, 6.5], [150 - 0.4 * t, 20, 9.0], [-150 + 0.3 * t, -50, 7.5], [60 + 0.5 * t, -45, 6.0]];
  for (let r = 0; r < ROWS; r++) {
    const lat = bounds.south + r * (bounds.north - bounds.south) / (ROWS - 1);
    for (let c = 0; c < COLS; c++) {
      const lng = bounds.west + c * (bounds.east - bounds.west) / (COLS - 1);
      const i = r * COLS + c;
      if (isLand(lat, lng)) { height[i] = NaN; direction[i] = 0; period[i] = NaN; conf[i] = NaN; continue; }
      let h = 1.0 + 0.6 * Math.cos(lat * Math.PI / 90) + 0.2 * Math.sin((lng + t * 2) * Math.PI / 37) * Math.cos(lat * Math.PI / 23);
      let dx = 0; let dy = 0;
      for (const [sx, sy, peak] of storms) {
        const wx = ((((lng - sx) % 360) + 540) % 360) - 180;
        const g = Math.exp(-(wx * wx + (lat - sy) ** 2) / 260);
        h += peak * g; dx += wx * g; dy += (lat - sy) * g;
      }
      height[i] = Math.round(Math.max(0, h) * 100) / 100;
      direction[i] = Math.round(((Math.atan2(dx + 0.3, dy + 0.1) * 180 / Math.PI + 360) % 360) * 100) / 100;
      period[i] = Math.round((7 + 1.6 * h) * 100) / 100;
      conf[i] = Math.round(Math.min(1, 0.5 + 0.1 * h) * 254) / 254;
    }
  }
  return { height, direction, period, conf };
}

function restamp(raw, validMs, runMs) {
  const b = Buffer.from(raw);
  b.writeDoubleLE(validMs / 1000, 56);
  b.writeDoubleLE(runMs / 1000, 64);
  return b;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const bounds = { west: -180, south: -80, east: 180, north: 84 };
  const reals = REAL ? fs.readdirSync(REAL).filter((f) => f.endsWith('.bin')).sort().map((f) => zlib.gunzipSync(fs.readFileSync(path.join(REAL, f)))) : [];
  const frames = [];
  let rawBytes = 0; let gzBytes = 0;
  for (let k = 0; k < N; k++) {
    const validMs = RUN_MS + k * STEP_H * 3600000;
    const raw = reals.length ? restamp(reals[k % reals.length], validMs, RUN_MS)
      : encodeFrame({ cols: COLS, rows: ROWS, bounds, validMs, runMs: RUN_MS, ...syntheticFrame(k, bounds) });
    const gz = zlib.gzipSync(raw, { level: 9 });
    const name = `f${String(k).padStart(3, '0')}.bin`;
    fs.writeFileSync(path.join(OUT, name), gz);
    frames.push({ path: name, valid_time: new Date(validMs).toISOString().replace(/\.\d{3}Z$/, 'Z'), bytes: gz.length, raw: raw.length });
    rawBytes += raw.length; gzBytes += gz.length;
  }
  const index = { source: reals.length ? `real:${reals.length}` : 'synthetic', cols: COLS, rows: ROWS, step_hours: STEP_H, frames };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ out: OUT, frames: N, source: index.source, rawBytes, gzBytes, meanGzKB: +(gzBytes / N / 1024).toFixed(1) }));
}

if (require.main === module) main();
module.exports = { encodeFrame };

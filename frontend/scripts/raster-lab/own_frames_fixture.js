// Synthetic OWN raster frames for the offline lab (2026-10-23): GFS mean-sea-level pressure as the publisher will write it, so the
// client (ownRasterFrames.js + ownRasterLayer.js) can be built and measured before the publisher lands.
// Contract (agreed with the static-frames lane): set GFS/weather/pressure/global_0p5, objects under
// v1/gfs/weather/pressure/global_0p5/{index,frames}/, listed in v1/latest.json; 720 x 361, bounds = outer cell centres
// -180..179.5 / -90..90, south row first, no wrap column; f000-f336 every 3 h; RSWF v1 field 6 pressure_hpa u16,
// scale 0.1, offset 799.9, code 0 = no data (byte-shuffled plane, as the marine u16 planes); gzipped, served WITHOUT
// Content-Encoding, immutable; the index carries credit, license, source_url, run, run_time, a `cycle` alias.
// The field: zonal climatology (subtropical highs, subpolar lows) plus drifting lows and highs, so scrubbing shows motion.
//   node own_frames_fixture.js --out <dir> [--anchor <ISO run time>] [--serve <port>] [--lat <ms per response>]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out');
const SET = 'GFS/weather/pressure/global_0p5';
const PREFIX = 'v1/gfs/weather/pressure/global_0p5';
const COLS = 720; const ROWS = 361; const W0 = -180; const S0 = -90; const E0 = 179.5; const N0 = 90;
const FIELD_ID = 6; const SCALE = 0.1; const OFFSET = 799.9;

function runAnchor() {
  const a = arg('--anchor');
  if (a) return Date.parse(a);
  const t = Date.now() - 5 * 3600e3;                    // the newest 6-hourly cycle that would be published by now
  return Math.floor(t / (6 * 3600e3)) * 6 * 3600e3;
}

// Pressure (hPa) at lat, lon for forecast hour h.
const SYSTEMS = [
  { lat0: 52, lon0: -40, amp: -28, r: 9, drift: 0.55 }, { lat0: -55, lon0: 60, amp: -32, r: 11, drift: 0.7 },
  { lat0: 35, lon0: -150, amp: 14, r: 16, drift: 0.25 }, { lat0: 28, lon0: -40, amp: 12, r: 18, drift: 0.2 },
  { lat0: 45, lon0: 150, amp: -22, r: 8, drift: 0.6 }, { lat0: -32, lon0: -100, amp: 10, r: 20, drift: 0.22 },
  { lat0: 18, lon0: -70, amp: -18, r: 3.5, drift: -0.35, dlat: 0.08 },                 // a tight tropical low, moving NW
];
function pressure(lat, lon, h) {
  const phi = (lat * Math.PI) / 180;
  let p = 1012 + 8 * Math.exp(-(((Math.abs(lat) - 32) / 9) ** 2)) - 12 * Math.exp(-(((Math.abs(lat) - 62) / 8) ** 2))
    + 4 * Math.cos(phi) * Math.sin(((lon + h * 1.5) * Math.PI) / 90);
  for (const s of SYSTEMS) {
    const clat = s.lat0 + (s.dlat || 0) * h;
    let dlon = lon - (s.lon0 + s.drift * h);
    dlon = ((dlon + 540) % 360) - 180;
    const d2 = (dlon * Math.cos(phi)) ** 2 + (lat - clat) ** 2;
    p += s.amp * Math.exp(-d2 / (2 * s.r * s.r));
  }
  return p;
}

function frameBytes(validSec, runSec, h) {
  const n = COLS * ROWS;
  const head = Buffer.alloc(72 + 24);
  head.write('RSWF', 0, 'ascii');
  head.writeUInt16LE(1, 4); head.writeUInt16LE(1, 6); head.writeUInt16LE(COLS, 8); head.writeUInt16LE(ROWS, 10);
  head.writeUInt32LE(1 << FIELD_ID, 12);
  head.writeUInt8(0, 16); head.writeUInt8(0, 17); head.writeUInt8(1, 18); head.writeUInt8(0, 19);
  head.writeUInt32LE(72 + 24, 20);
  head.writeDoubleLE(W0, 24); head.writeDoubleLE(S0, 32); head.writeDoubleLE(E0, 40); head.writeDoubleLE(N0, 48);
  head.writeDoubleLE(validSec, 56); head.writeDoubleLE(runSec, 64);
  head.writeUInt8(FIELD_ID, 72); head.writeUInt8(2, 73); head.writeUInt8(1, 74); head.writeUInt8(0, 75);
  head.writeUInt32LE(0, 76); head.writeDoubleLE(SCALE, 80); head.writeDoubleLE(OFFSET, 88);
  const plane = Buffer.alloc(2 * n);
  for (let r = 0; r < ROWS; r++) {
    const lat = S0 + r * 0.5;
    for (let c = 0; c < COLS; c++) {
      const code = Math.max(1, Math.min(65535, Math.round((pressure(lat, W0 + c * 0.5, h) - OFFSET) / SCALE)));
      const k = r * COLS + c;
      plane[k] = code & 0xff; plane[n + k] = code >> 8;            // byte-shuffled: every low byte, then every high byte
    }
  }
  return zlib.gzipSync(Buffer.concat([head, plane]), { level: 9 });
}

function build() {
  const run = runAnchor();
  const runIso = new Date(run).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const runKey = runIso.replace(/[-:]/g, '').replace('T', '_').slice(0, 11) + 'z';
  const frames = [];
  let bytes = 0;
  for (let h = 0; h <= 336; h += 3) {
    const valid = run + h * 3600e3;
    const rel = `${PREFIX}/frames/${runKey}/f${String(h).padStart(3, '0')}.rswf.gz`;
    const gz = frameBytes(valid / 1000, run / 1000, h);
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), gz);
    bytes += gz.length;
    frames.push({ valid_time: new Date(valid).toISOString().replace(/\.\d{3}Z$/, 'Z'), path: rel, is_estimated: false, bytes: gz.length });
  }
  const indexRel = `${PREFIX}/index/${runKey}.json`;
  const index = {
    encoding_version: 1, transform_version: 1, set: SET, run: runKey, run_time: runIso, cycle: runIso,
    credit: 'NOAA/NCEP GFS', license: 'US Government work (public domain)', source_url: 'https://nomads.ncep.noaa.gov/',
    grid: { cols: COLS, rows: ROWS, bounds: { west: W0, south: S0, east: E0, north: N0 } },
    fields: [{ id: FIELD_ID, name: 'pressure_hpa', unit: 'hPa' }], common_meta: {}, frames, synthetic: true,
  };
  fs.mkdirSync(path.dirname(path.join(OUT, indexRel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, indexRel), JSON.stringify(index));
  fs.mkdirSync(path.join(OUT, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'v1/latest.json'), JSON.stringify({ sets: { [SET]: { index: indexRel, run: runKey } } }));
  console.log(JSON.stringify({ run: runIso, frames: frames.length, totalBytes: bytes, meanFrameBytes: Math.round(bytes / frames.length) }));
}

function serve(port, lat) {
  http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.resolve(OUT, rel);
    const headers = { 'Access-Control-Allow-Origin': '*', 'Timing-Allow-Origin': '*' };
    if (!file.startsWith(path.resolve(OUT) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, headers); res.end(); return; }
    headers['Content-Type'] = rel.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    headers['Cache-Control'] = rel === 'v1/latest.json' ? 'no-cache' : 'public, max-age=31536000, immutable';
    const body = fs.readFileSync(file);
    setTimeout(() => { res.writeHead(200, headers); res.end(body); }, lat);
  }).listen(port, '127.0.0.1', () => console.log(`own frames CDN on ${port} (${lat} ms per response)`));
}

if (!OUT) { console.error('--out <dir> is required'); process.exit(2); }
if (!process.argv.includes('--no-build')) build();
if (arg('--serve')) serve(+arg('--serve'), +(arg('--lat', '0')));

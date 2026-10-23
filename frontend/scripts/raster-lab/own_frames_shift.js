// Shift a published own-frames set in time (2026-10-23), so REAL frames line up with the lab's pinned clock (rr-cache meta.json
// tRec): the .om arm replays a recording, and its clock decides which hours both arms ask for. Every frame's header valid/run
// epochs and the index's run, cycle, run_time and valid_time fields move by the same delta; the field values are untouched.
//   node own_frames_shift.js --in <published dir with v1/latest.json> --out <dir> --run <new run ISO, e.g. 2026-10-22T18:00:00Z>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const IN = arg('--in'); const OUT = arg('--out'); const RUN = Date.parse(arg('--run'));
if (!IN || !OUT || !Number.isFinite(RUN)) { console.error('--in, --out and --run are required'); process.exit(2); }

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const latest = JSON.parse(fs.readFileSync(path.join(IN, 'v1/latest.json'), 'utf8'));
for (const [key, entry] of Object.entries(latest.sets || {})) {
  const index = JSON.parse(fs.readFileSync(path.join(IN, entry.index), 'utf8'));
  const oldRun = Date.parse(index.run_time || index.run);
  const d = RUN - oldRun;
  const mv = (s) => (typeof s === 'string' && Number.isFinite(Date.parse(s)) ? iso(Date.parse(s) + d) : s);
  for (const f of index.frames) {
    f.valid_time = mv(f.valid_time);
    if (!f.path) continue;
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(IN, f.path)));
    raw.writeDoubleLE(raw.readDoubleLE(56) + d / 1000, 56);
    raw.writeDoubleLE(raw.readDoubleLE(64) + d / 1000, 64);
    const gz = zlib.gzipSync(raw, { level: 9 });
    fs.mkdirSync(path.dirname(path.join(OUT, f.path)), { recursive: true });
    fs.writeFileSync(path.join(OUT, f.path), gz);
    f.bytes = gz.length;
    delete f.sha256;                                       // the bytes changed
  }
  for (const k of ['run', 'cycle', 'run_time']) index[k] = mv(index[k]);
  if (index.common_meta) index.common_meta.model_run_time = mv(index.common_meta.model_run_time);
  index.shifted_from = iso(oldRun);
  fs.mkdirSync(path.dirname(path.join(OUT, entry.index)), { recursive: true });
  fs.writeFileSync(path.join(OUT, entry.index), JSON.stringify(index));
  for (const k of ['run', 'cycle', 'run_time']) entry[k] = mv(entry[k]);
  console.log(`${key}: ${index.frames.length} frames moved by ${d / 3600000} h (run ${iso(oldRun)} -> ${iso(RUN)})`);
}
fs.mkdirSync(path.join(OUT, 'v1'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'v1/latest.json'), JSON.stringify(latest));

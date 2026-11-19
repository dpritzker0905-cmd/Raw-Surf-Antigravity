// A local stand-in for the static frame CDN that holds REAL wave frames, so the client's static paths (world frames, the
// mid-zoom crop, the GPU frame store) run offline as they do in production. Log: 2026-11-16-fable-first-visit-fine.md, section 6.
//
// Input: a folder written by `real_frames_hidden_hour.mjs fetch` (manifest.json, each set's saved index JSON, and the frames
// as decompressed .bin files). Output: <out>/v1/latest.json, each set's index at its ORIGINAL path, and each frame at its
// original path, gzipped as the CDN serves it. Only frames present in the input are listed, so a listed frame always exists.
//   node wave_frames_fixture.js --in <real-frames dir> --out <dir> [--sets waves,swell_1] [--drop 2026-11-18T09:00:00Z] [--serve 4294]
// --drop removes one valid time from every index (a forced static miss, the gate's F7). --serve answers GETs with CORS open.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const http = require('http');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : d; };
const IN = arg('in'); const OUT = arg('out'); const SERVE = arg('serve'); const DROP = arg('drop', null);
if (!IN || !OUT) { console.log('usage: node wave_frames_fixture.js --in <real-frames dir> --out <dir> [--sets ..] [--drop <iso>] [--serve <port>]'); process.exit(2); }
const SET_OF = { waves: 'GFS/marine/waves/global_mid', swell_1: 'GFS/marine/swell_1/global_mid', swell_2: 'GFS/marine/swell_2/global_mid', wind_waves: 'GFS/marine/wind_waves/global_mid', wind: 'GFS/wind/wind/global_mid' };
const SETS = arg('sets', 'waves').split(',').map((s) => s.trim()).filter(Boolean);

const manifest = JSON.parse(fs.readFileSync(path.join(IN, 'manifest.json'), 'utf8'));
const write = (rel, buf) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };
const latest = { sets: {} };
for (const name of SETS) {
  const key = SET_OF[name]; if (!key) throw new Error(`unknown set "${name}"`);
  const runs = manifest.runs.filter((r) => r.set === name); if (!runs.length) { console.log(`${name}: not in the input, skipped`); continue; }
  const run = runs[0];   // the first listed index of the set (the one current when it was fetched)
  const index = JSON.parse(fs.readFileSync(path.join(IN, run.index), 'utf8'));
  const have = new Map(run.frames.map((f) => [new Date(f.valid).toISOString(), f.file]));
  const kept = [];
  for (const fr of index.frames) {
    const iso = new Date(fr.meta && fr.meta.valid_time).toISOString(); const file = have.get(iso);
    if (!file || fr.is_estimated) continue;
    if (DROP && new Date(DROP).toISOString() === iso) continue;
    write(fr.path, zlib.gzipSync(fs.readFileSync(path.join(IN, file))));
    kept.push(fr);
  }
  const indexRel = index.path || `v1/${name}-index.json`;
  write(indexRel, JSON.stringify({ ...index, frames: kept }));
  latest.sets[key] = { index: indexRel, run: index.run };
  console.log(`${name}: ${kept.length} frames, run ${index.run}, valid ${kept[0].meta.valid_time} to ${kept[kept.length - 1].meta.valid_time}${DROP ? `, dropped ${DROP}` : ''}`);
}
write('v1/latest.json', JSON.stringify(latest));

if (SERVE) {
  const hits = { latest: 0, index: 0, frame: 0, miss: 0 };
  http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    if (rel === '__hits') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(hits)); return; }
    const f = path.join(OUT, rel);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (!f.startsWith(path.resolve(OUT)) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { hits.miss += 1; res.writeHead(404, cors); res.end('not found'); return; }
    if (rel === 'v1/latest.json') hits.latest += 1; else if (rel.endsWith('.json')) hits.index += 1; else hits.frame += 1;
    res.writeHead(200, { ...cors, 'Content-Type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Cache-Control': rel === 'v1/latest.json' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    fs.createReadStream(f).pipe(res);
  }).listen(+SERVE, '127.0.0.1', () => console.log(`serving ${OUT} on http://127.0.0.1:${SERVE}/ (GET /__hits for counts)`));
}

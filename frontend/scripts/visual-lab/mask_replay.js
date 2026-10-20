// MASK REPLAY — the land-mask paint of a git REF vs the working tree, on paints captured from the real app (2026-10-20).
//
// Proves a mask change byte-identical (or shows where it is not) and times it, outside the app: every paint captured by
// scripts/offline-backend/scn_mask_capture.js (canvas bounds, map bounds, style water layers, every feature MapLibre handed
// the painter) is replayed through BOTH versions of WebGLMarineMaskRenderer + marineMaskShelter + inlandWaterGuard +
// marineMaskProjection in headless Chrome: renderMaskToCanvas, then overlayBasemapWaterOnMask, then a byte compare of the
// finished canvases, of the painter's verdict (applied / degraded) and of its receipts (open-water counts, inland guard,
// island re-assert). REPS fresh pages (module caches reset), OLD/NEW order
// alternated per paint and per rep; the timed window ends with a 1 px read so Chrome's deferred raster is inside it.
//
//   node scripts/visual-lab/mask_replay.js <ref> <reps> <capture.json>... [--land10m <ne_10m_land.json>]
//   e.g. node scripts/visual-lab/mask_replay.js origin/dev 5 cap-dark.json cap-light.json cap-beach.json
//
// SLICED=1: the working tree's paint runs as the sliced scheduler runs it (maskSliceScheduler.js: the same
// overlayBasemapWaterSteps, a 1 px flush every 24 draws and after every pass), so the byte compare proves a sliced paint
// equal to the reference's one-call paint; `passes` then gives, per named pass, the longest piece any paint ran in one go.
// The 10 m land file is the one the app fetches (mapUtils.js NE_10M_LAND_URL); pass a local copy with --land10m (the
// script never downloads anything). The 50 m file is frontend/public/ne_50m_land.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const li = args.indexOf('--land10m');
const land10m = li >= 0 ? args.splice(li, 2)[1] : null;
const [ref, repsArg, ...caps] = args;
if (!ref || !caps.length || !land10m) { console.error('usage: mask_replay.js <ref> <reps> <capture.json>... --land10m <file>'); process.exit(2); }
const REPS = +repsArg || 5;
const FRONT = path.resolve(__dirname, '..', '..');
const MAP = path.join(FRONT, 'src', 'components', 'map');
const MODULES = ['WebGLMarineMaskRenderer.js', 'basemapWaterOverlay.js', 'marineMaskShelter.js', 'inlandWaterGuard.js', 'marineMaskProjection.js', 'maskFastPaths.js'];
const SLICED = process.env.SLICED === '1';
const posix = (p) => p.split(path.sep).join('/');

function bundle(work) {
  const old = path.join(work, 'old'); fs.mkdirSync(old, { recursive: true });
  for (const f of MODULES) {
    let src;
    try { src = execFileSync('git', ['show', `${ref}:frontend/src/components/map/${f}`], { cwd: FRONT, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { continue; }   // absent at REF
    fs.writeFileSync(path.join(old, f), src.split("from './mapUtils'").join(`from '${posix(path.join(MAP, 'mapUtils'))}'`));
  }
  fs.writeFileSync(path.join(work, 'entry.js'), [
    `import * as NR from '${posix(path.join(MAP, 'WebGLMarineMaskRenderer'))}';`,
    "import * as OR from './old/WebGLMarineMaskRenderer';",
    SLICED ? `import * as NS from '${posix(path.join(MAP, 'basemapWaterOverlay'))}';` : 'const NS = null;',
    'window.MASK = { NEW: NR, OLD: OR, STEPS: NS };', ''].join('\n'));
  const webpack = require(require.resolve('webpack', { paths: [FRONT] }));
  return new Promise((resolve, reject) => webpack({
    mode: 'production', devtool: false, entry: path.join(work, 'entry.js'), output: { path: path.join(work, 'dist'), filename: 'bench.js' },
    resolve: { modules: [path.join(FRONT, 'node_modules')] }, performance: { hints: false }, optimization: { minimize: false },
  }, (err, stats) => (err || stats.hasErrors() ? reject(err || new Error(stats.toString('errors-only'))) : resolve())));
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-replay-'));
  await bundle(work);
  const files = { '/dist/bench.js': path.join(work, 'dist', 'bench.js'), '/g10.json': path.resolve(land10m), '/g50.json': path.join(FRONT, 'public', 'ne_50m_land.json') };
  const { chromium } = require(require.resolve('playwright', { paths: [FRONT] }));
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
  const per = {};
  for (let rep = 0; rep < REPS; rep++) {
    const page = await browser.newPage();
    let capFile = null;
    await page.route('http://replay.local/**', (r) => {
      const u = new URL(r.request().url()).pathname;
      if (u === '/') return r.fulfill({ contentType: 'text/html', body: '<html><body><script>window.process = { env: { NODE_ENV: "production" } };</script><script src="/dist/bench.js"></script></body></html>' });
      const f = u === '/cap.json' ? capFile : files[u];
      if (!f) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'application/javascript' : 'application/json' });
    });
    await page.goto('http://replay.local/'); await page.waitForFunction(() => !!window.MASK);
    await page.evaluate(async () => { window.G10 = await (await fetch('/g10.json')).json(); window.G50 = await (await fetch('/g50.json')).json(); });
    for (const cf of caps) {
      capFile = path.resolve(cf);
      await page.evaluate(async () => { window.CAP = await (await fetch('/cap.json?' + Math.random())).json(); });
      const r = await page.evaluate(([rp, sliced]) => {
        const mkMap = (pt) => { const rq = pt.rendered.slice(), sq = pt.source.slice();
          return { getStyle: () => ({ layers: pt.style }), getZoom: () => pt.zoom, queryRenderedFeatures: () => (rq.shift() || { feats: [] }).feats,
            querySourceFeatures: (src, o) => { const i = sq.findIndex((s) => s.sourceLayer === (o && o.sourceLayer)); return i >= 0 ? sq.splice(i, 1)[0].feats : []; },
            getBounds: () => ({ getWest: () => pt.mapBounds.west, getEast: () => pt.mapBounds.east, getSouth: () => pt.mapBounds.south, getNorth: () => pt.mapBounds.north }) }; };
        const run = (impl, pt) => { const M = window.MASK[impl]; const mock = mkMap(pt);
          const t0 = performance.now(); const water = M.prepareBasemapWaterOverlay(mock);
          const canvas = M.renderMaskToCanvas(pt.geo === '10m' ? window.G10 : window.G50, pt.bounds, pt.kind === 'overlay' ? { maxWidth: 2048 } : undefined);
          const t1 = performance.now(); let applied; let seg = null;
          if (impl === 'NEW' && sliced) {
            seg = {}; const NS = window.MASK.STEPS; const inputs = NS.snapshotOverlayInputs(mock, water); applied = false;
            if (inputs) {
              const it = NS.overlayBasemapWaterSteps(canvas, pt.bounds, inputs); let draws = 0;
              for (;;) {
                const ts = performance.now(); const st = it.next(); if (st.done) { applied = st.value; break; }
                if (st.value === 1) draws++;
                if (draws && (draws >= 24 || st.value !== 1)) { canvas.getContext('2d').getImageData(0, 0, 1, 1); draws = 0; }
                const lab = st.value === 1 ? 'draws' : st.value; const d = performance.now() - ts; if (!(seg[lab] >= d)) seg[lab] = d;
              }
            }
          } else applied = M.overlayBasemapWaterOnMask(canvas, pt.bounds, mock, water);
          canvas.getContext('2d').getImageData(0, 0, 1, 1);
          const w = performance.now() - t1;
          const g = window.__RAW_GPU__ || {};   // the painter's own receipts: they must match too, not just the pixels
          const receipts = JSON.stringify([g.openWaterVerdict || null, g.inlandWaterGuard || null, g.islandReassert || null]);
          window.__RAW_GPU__ = {};
          return { canvas, applied, r: t1 - t0, w, receipts, seg }; };
        window.__RAW_GPU__ = {};
        const o = { n: 0, identical: 0, verdicts: 0, receipts: 0, old: 0, neu: 0, oldR: 0, newR: 0, diffs: [], segs: [] };
        window.CAP.paints.filter((pt) => pt.bounds && pt.mapBounds).forEach((pt, k) => {
          const newFirst = (k + rp) % 2 === 1;
          const a0 = newFirst ? null : run('OLD', pt); const b = run('NEW', pt); const a = a0 || run('OLD', pt);
          const da = a.canvas.getContext('2d').getImageData(0, 0, a.canvas.width, a.canvas.height).data;
          const db = b.canvas.getContext('2d').getImageData(0, 0, b.canvas.width, b.canvas.height).data;
          let diff = da.length === db.length ? 0 : -1; if (!diff) for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
          o.n++; if (diff === 0) o.identical++; else o.diffs.push({ paint: k, kind: pt.kind, bytes: diff });
          if (!!a.applied === !!b.applied && !!(a.applied && a.applied.degraded) === !!(b.applied && b.applied.degraded)) o.verdicts++;
          if (a.receipts === b.receipts) o.receipts++; else if (o.diffs.length < 5) o.diffs.push({ paint: k, kind: pt.kind, receipts: [a.receipts, b.receipts] });
          o.old += a.r + a.w; o.neu += b.r + b.w; o.oldR += a.r; o.newR += b.r;
          if (b.seg) o.segs.push({ kind: pt.kind, baseCanvas: b.r, ...b.seg });
        });
        return o;
      }, [rep, SLICED]);
      (per[path.basename(cf)] ||= []).push(r);
    }
    await page.close();
  }
  await browser.close();
  const out = {};
  for (const [name, rs] of Object.entries(per)) {
    out[name] = { reps: rs.length, paints: rs[0].n, identicalEveryRep: rs.every((x) => x.identical === x.n), verdictsSameEveryRep: rs.every((x) => x.verdicts === x.n),
      receiptsSameEveryRep: rs.every((x) => x.receipts === x.n),
      firstDiffs: rs.flatMap((x) => x.diffs).slice(0, 5),
      oldMsMedian: Math.round(med(rs.map((x) => x.old))), newMsMedian: Math.round(med(rs.map((x) => x.neu))),
      oldRasterMsMedian: Math.round(med(rs.map((x) => x.oldR))), newRasterMsMedian: Math.round(med(rs.map((x) => x.newR))),
      perRep: rs.map((x) => [Math.round(x.old), Math.round(x.neu)]) };
    if (SLICED) {   // per pass: median and max (over paints x reps) of the longest piece it ran in one go, ms
      const all = rs.flatMap((x) => x.segs); const labs = [...new Set(all.flatMap((g) => Object.keys(g)))].filter((k) => k !== 'kind');
      out[name].passes = Object.fromEntries(labs.map((k) => { const v = all.map((g) => g[k]).filter((x) => typeof x === 'number');
        return [k, { median: +med(v).toFixed(1), max: +Math.max(...v).toFixed(1), over16: v.filter((x) => x > 16).length, n: v.length }]; }));
    }
    out[name].cut = +(1 - out[name].newMsMedian / out[name].oldMsMedian).toFixed(3);
  }
  console.log(JSON.stringify({ ref, reps: REPS, captures: out }, null, 1));
  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });

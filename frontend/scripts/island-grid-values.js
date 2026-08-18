/**
 * island-grid-values.js — is the island ring a DATA defect or a RENDERING defect?
 *
 * WHAT IS ESTABLISHED VISUALLY. At Madeira z9.3 a broad turquoise (low-value) ring surrounds the
 * island on EVERY side, including the exposed north-west; at mainland Lisbon the field is uniform
 * right up to the shoreline with no band at all. A ring on all sides is not physical sheltering, and
 * the symbol-suppressed gap survey already proved the field is not MISSING (band median 0 m
 * everywhere) — so it is present and reading LOW.
 *
 * THE FORK, and it decides where the fix goes:
 *   DATA      the grid cells around the island genuinely hold low/zero values (land cells with no
 *             wave data), and bilinear interpolation spreads that hole across ~1 cell of open water.
 *             => fix is data-side: fill land cells from nearest water before upload, or make the
 *                fetch land-aware. NOTHING in the shader or the mask can help.
 *   RENDERING the grid holds sane values near the island and something downstream depresses them.
 *             => fix is in the pass.
 *
 * ⭐ WHY THIS READ IS TRUSTWORTHY WHEN THE PIXEL READS WERE NOT. It reads the NUMBERS the engine
 * holds (`_waveData.waveGrid`), not the composited canvas. Labels, shields, blend modes, themes and
 * layer order — every contaminant that produced a false finding in this arc, up to and including the
 * road shield that masqueraded as an 836 m halo — cannot touch it.
 *
 * OUTPUT: the grid as a value matrix with each cell's centre coordinate and whether that centre is
 * basemap LAND, plus the water-cell/land-cell value split. The prediction under DATA is explicit and
 * falsifiable: land cells ~0, and water cells ADJACENT to them markedly below open-ocean cells.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-grid-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[grid] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const CAMERAS = [
  { id: 'madeira_z9.3', center: [-16.95, 32.75], z: 9.3, kind: 'island' },
  { id: 'lisbon_z9.3', center: [-8.95, 38.85], z: 9.3, kind: 'mainland' },
];

const dump = () => {
  const m = window.map, eng = window.__MARINE_ENGINE__;
  if (!eng) return { err: 'no engine' };
  const wd = eng._waveData;
  if (!wd || !wd.bounds) return { err: 'no _waveData.bounds' };
  const g = wd.waveGrid;
  if (!g) return { err: 'no waveGrid', keys: Object.keys(wd) };

  // SHAPE: {bounds, cols, rows, vectors:[{lat,lng,height,speed,isOcean,is_valid,...}]}.
  // Each vector carries its OWN lat/lng, so positions are read, never recomputed from bounds — one
  // less place for a row-order/flip assumption to invent a finding.
  const vec = Array.isArray(g.vectors) ? g.vectors : null;
  if (!vec) return { err: 'unrecognised waveGrid shape', sample: JSON.stringify(g).slice(0, 400) };
  const W = g.cols, H = g.rows, b = wd.bounds;

  // ⛔ PRECONDITION. `_waveData` lags the camera: at Madeira it has twice been observed still holding
  // the PREVIOUS region (Florida, west -81.3). Reporting that as the island's grid would be a false
  // finding of exactly the kind this arc keeps producing, so refuse instead of reporting.
  const ctr = m.getCenter();
  const covers = b && ctr.lng >= b.west && ctr.lng <= b.east && ctr.lat >= b.south && ctr.lat <= b.north;
  if (!covers) return { err: 'GRID DOES NOT COVER THE CAMERA — stale region, refusing to report',
    bounds: b, center: { lng: +ctr.lng.toFixed(3), lat: +ctr.lat.toFixed(3) } };

  const valOf = (o) => {
    if (!o) return null;
    for (const k of ['height', 'speed', 'waveHeight', 'value']) if (typeof o[k] === 'number') return o[k];
    return null;
  };
  const oceanFlag = (o) => {
    if (!o) return null;
    if (typeof o.isOcean === 'boolean') return o.isOcean;
    if (o.waves && typeof o.waves.isOcean === 'boolean') return o.waves.isOcean;
    if (o.waves && typeof o.waves.is_valid === 'boolean') return o.waves.is_valid;
    if (typeof o.is_valid === 'boolean') return o.is_valid;
    return null;
  };
  const waterIds = (m.getStyle().layers || [])
    .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
    .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
  const rect = m.getContainer().getBoundingClientRect();
  const landAt = (lng, lat) => {
    const pp = m.project([lng, lat]);
    if (!(pp.x >= 0 && pp.y >= 0 && pp.x < rect.width && pp.y < rect.height)) return null;
    try { return m.queryRenderedFeatures([pp.x, pp.y], { layers: waterIds }).length === 0; } catch (e) { return null; }
  };

  const cells = [];
  for (let i = 0; i < vec.length; i++) {
    const o = vec[i];
    cells.push({ r: Math.floor(i / W), c: i % W, lng: +Number(o.lng).toFixed(4), lat: +Number(o.lat).toFixed(4),
      v: valOf(o), ocean: oceanFlag(o), land: landAt(o.lng, o.lat) });
  }
  return { bounds: b, W, H, cells,
    cellKm: +(((b.east - b.west) / W) * 111.32 * Math.cos(((b.north + b.south) / 2) * Math.PI / 180)).toFixed(1),
    zoom: +m.getZoom().toFixed(2), sampleCell: JSON.stringify(vec[0]).slice(0, 220) };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 180000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 180000 });

  const all = [];
  for (const cam of CAMERAS) {
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: cam.center, z: cam.z });
    await page.waitForTimeout(12000);
    // The grid lags the camera, so POLL until it covers this camera rather than reading whatever is
    // resident. A refusal that can be waited out should be waited out; a refusal that cannot is a
    // finding in its own right, and the loop reports which one happened.
    let r = await page.evaluate(dump);
    for (let t = 0; t < 12 && r.err && /stale region/.test(r.err); t++) {
      await page.waitForTimeout(4000);
      r = await page.evaluate(dump);
    }
    log(`=== ${cam.id} (${cam.kind}) ===`);
    if (r.err) { log(`  ERR ${r.err}  ${r.keys ? JSON.stringify(r.keys) : (r.sample || '')}`); all.push({ cam: cam.id, ...r }); continue; }
    log(`  bounds ${JSON.stringify(r.bounds)}  grid ${r.W}x${r.H}  cell ~${r.cellKm} km  cell0=${r.sampleCell}`);
    const fmt = (v) => v === null ? '  . ' : (v < 10 ? ' ' : '') + v.toFixed(1);
    for (let row = 0; row < r.H; row++) {
      const line = r.cells.filter((c) => c.r === row)
        .map((c) => `${fmt(c.v)}${c.land === true ? 'L' : c.land === false ? ' ' : '?'}`).join(' ');
      log('    ' + line);
    }
    const water = r.cells.filter((c) => c.land === false && typeof c.v === 'number').map((c) => c.v);
    const land = r.cells.filter((c) => c.land === true && typeof c.v === 'number').map((c) => c.v);
    const avg = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;
    const mn = (a) => a.length ? +Math.min.apply(null, a).toFixed(2) : null;
    const mx = (a) => a.length ? +Math.max.apply(null, a).toFixed(2) : null;
    log(`  WATER cells n=${water.length} min ${mn(water)} avg ${avg(water)} max ${mx(water)}`);
    log(`  LAND  cells n=${land.length} min ${mn(land)} avg ${avg(land)} max ${mx(land)}   (L marks land, ? = off-screen)`);
    if (land.length && water.length) {
      log(`  => land cells average ${avg(land)} vs water ${avg(water)}  `
        + (avg(land) < avg(water) * 0.5
          ? '— LAND CELLS ARE A HOLE IN THE DATA. Bilinear spreads it into open water: DATA-SIDE cause.'
          : '— land cells are NOT a hole; the ring is not a land-cell artifact.'));
    } else {
      log('  => no land/water split available at this camera (cells off-screen or unclassified) — no verdict.');
    }
    all.push({ cam: cam.id, kind: cam.kind, ...r });
  }
  await ctx.close(); await browser.close();
  fs.writeFileSync(path.join(outdir, 'grid.json'), JSON.stringify({ base: BASE, all }, null, 1));
  log('written: ' + path.join(outdir, 'grid.json'));
})().catch((e) => { console.error(e); process.exit(1); });

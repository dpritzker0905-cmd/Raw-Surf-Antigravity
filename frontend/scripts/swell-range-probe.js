/**
 * swell-range-probe.js — DOES THE INDEPENDENT VARIABLE HAVE RANGE?
 *
 * The residual suppression (§27a: bearings 9,12,13,14,15 stay at a0 ~0.05-0.10 with the island
 * re-assert fully disabled) has two candidate explanations, and they differ in WHAT the arc is tied
 * to:
 *   (A) SHELTERING physics  -> tied to SWELL DIRECTION  -> the arc ROTATES as the swell shifts
 *   (B) NEARSHORE DATA DECAY -> tied to COASTLINE GEOMETRY (forecastHelpers.js:271-288 multiplies
 *       height by 0.65/0.45/0.35 when 1/2/3+ of the 4 sampled neighbours are land) -> the arc is
 *       FIXED regardless of swell
 * Only a LONGITUDINAL test separates them: same island (geometry held), swell direction varied. A
 * multi-island test confounds the two, because each island differs in geometry AND swell at once.
 *
 * ⛔ BUT THAT TEST IS WORTHLESS IF THE SWELL DIRECTION BARELY MOVES ACROSS THE FORECAST WINDOW, and
 * a null result would then be indistinguishable from "the arc does not rotate". The density-gate
 * Jacobian died exactly this way — it was built on an independent variable (850 px/deg) that was not
 * actually held constant, and nobody checked first. So this probe measures ONLY the range of the
 * driver, before any arc measurement is built on it.
 *
 * Drives the real scrubber by KEYBOARD (ForecastWheel is role="slider" with ArrowLeft/Right = +-1 h
 * and PageUp/PageDown = +-1 day, ForecastWheel.js:280-282), which is the documented accessibility
 * contract rather than a poked internal. Reads the swell direction the RENDERER is actually holding,
 * out of engine._waveData.waveGrid.directions, circular-averaged over the 4 surrounding cells the
 * same way forecastHelpers.js does.
 *
 * Reports: aria-valuenow per step (did the wheel actually move), the sampled swell direction, and
 * whether the resident grid CHANGED between steps (a direction that never moves because the marine
 * data never re-committed is a false negative, not a finding).
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'swell-range-probe-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[swell] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { center: [-16.92, 32.74], z: 9.30 };
// Sample swell direction from OPEN WATER rather than the island centroid: the resident grid is only
// 7x7 / 8x8 over a ~2 deg span (~28-37 km per cell — that part IS measured, from cols/rows), so a
// centroid sample sits on cells the island itself occupies. Four probes ~0.6 deg out on four sides,
// each reported separately, because one probe landing on a land cell would silently become a null.
// ⚠️ RETRACTED: an earlier comment here claimed it was MEASURED that the centroid cells are
// null/zero. That reading came from the broken cell[0]/cell[1] reader, which returned null for every
// cell regardless of land or water. Whether the island's cells are actually empty is NOT established.
const SWELL_PROBES = [
  { id: 'W', d: [-0.60, 0.00] }, { id: 'N', d: [0.00, 0.55] },
  { id: 'E', d: [0.60, 0.00] }, { id: 'S', d: [0.00, -0.55] },
];
const DAY_STEPS = [0, 1, 2, 3, 4];   // PageUp presses => +1 day each

const readSwell = ({ c }) => {
  const e = window.__MARINE_ENGINE__;
  if (!e || !e._waveData) return { ok: false, why: 'no wave data' };
  const wd = e._waveData;
  const g = wd.waveGrid || wd;
  // MEASURED, not assumed: the resident grid exposes `cols`/`rows` and carries direction inside
  // `vectors` (there is no `directions` array on this object) — and at Madeira it is SEVEN BY SEVEN,
  // i.e. ~0.33 deg (~37 km) per cell, ~296 device px at z9.3. A 404 px ray spans ~1.4 cells.
  const b = wd.bounds || g.bounds;
  const nx = g.cols || g.width || g.nx;
  const ny = g.rows || g.height || g.ny;
  const vec = g.vectors;
  const dirs = g.directions;
  if ((!dirs && !vec) || !b || !nx || !ny) {
    return { ok: false, why: 'grid shape unknown',
      keys: Object.keys(g).slice(0, 25), hasDirs: !!dirs, hasVec: !!vec, bounds: b || null, nx: nx || null, ny: ny || null };
  }
  // ⛔ READ FROM THE SOURCE, NOT GUESSED (GridParserWorker.js:72-86). Each entry is an OBJECT
  // { u, v, speed, lat, lng } — NOT an [x,y] pair and NOT a flat interleaved array. An earlier
  // version indexed cell[0]/cell[1], which returns undefined for EVERY cell, land or water, and so
  // reported "all neighbours null" everywhere. That false reading was briefly taken as evidence that
  // the island's cells are land-zeroed; it was the instrument, not the data.
  const dirAt = (i) => {
    if (dirs) { const v = dirs[i]; return (typeof v === 'number' && !isNaN(v)) ? v : null; }
    const cell = vec[i];
    if (!cell || typeof cell !== 'object') return null;
    const u = cell.u, v = cell.v;
    if (typeof u !== 'number' || typeof v !== 'number' || isNaN(u) || isNaN(v)) return null;
    if (u === 0 && v === 0) return null;                 // genuinely absent (land / no data)
    let d = Math.atan2(u, v) * 180 / Math.PI;            // u = east, v = north => 0 = N, clockwise
    if (d < 0) d += 360;
    return d;
  };
  // Each cell carries its OWN lat/lng, so locate by position rather than by deriving indices from
  // bounds — one less assumption, and it self-checks against the cell we actually read.
  const nearestIdx = (lng, lat) => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < vec.length; i++) {
      const c = vec[i];
      if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      const dd = (c.lng - lng) * (c.lng - lng) + (c.lat - lat) * (c.lat - lat);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  };
  const west = b.west !== undefined ? b.west : b[0];
  const south = b.south !== undefined ? b.south : b[1];
  const east = b.east !== undefined ? b.east : b[2];
  const north = b.north !== undefined ? b.north : b[3];
  const fx = (c[0] - west) / (east - west) * (nx - 1);
  const fy = (c[1] - south) / (north - south) * (ny - 1);
  const x0 = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
  const dx = fx - x0, dy = fy - y0;
  const idx = (x, y) => y * nx + x;
  const ni = nearestIdx(c[0], c[1]);
  const d = [dirAt(idx(x0, y0)), dirAt(idx(x0 + 1, y0)), dirAt(idx(x0, y0 + 1)), dirAt(idx(x0 + 1, y0 + 1)),
    ni >= 0 ? dirAt(ni) : null];
  const w = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy, 0];
  let ss = 0, cc = 0, used = 0;
  for (let i = 0; i < 4; i++) {
    const v = d[i];
    if (typeof v !== 'number' || isNaN(v)) continue;
    const r = v * Math.PI / 180;
    ss += Math.sin(r) * w[i]; cc += Math.cos(r) * w[i]; used++;
  }
  // Fall back to the nearest-by-coordinate cell if the bounds-derived corners are all empty — and
  // SAY which path produced the number, so a fallback is never mistaken for a clean bilinear read.
  let via = 'bilinear';
  if (!used) {
    if (d[4] === null) {
      return { ok: false, why: 'corners AND nearest cell empty', nx, ny, cornersRaw: d,
        nearestCell: ni >= 0 ? vec[ni] : null, sampleCell: vec[0] };
    }
    ss = Math.sin(d[4] * Math.PI / 180); cc = Math.cos(d[4] * Math.PI / 180); used = 1; via = 'nearest';
  }
  let deg = Math.atan2(ss, cc) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  // fingerprint the grid so "the direction did not move" can be told from "the data never changed"
  const n = nx * ny;
  let fp = 0;
  for (let i = 0; i < n; i++) { const v = dirAt(i); if (v !== null) fp += v * (i % 7 + 1); }
  return { ok: true, dirDeg: +deg.toFixed(1), via, corners: d, gridFingerprint: Math.round(fp),
    nx, ny, landCells: n - d.filter((x) => x !== null).length, bounds: { west, south, east, north } };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
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
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);

  const wheel = await page.$('[role="slider"][aria-label*="Forecast timeline"]');
  if (!wheel) {
    log('REFUSED: no forecast timeline wheel found (role=slider, aria-label*="Forecast timeline")');
    const sliders = await page.$$eval('[role="slider"]', (ns) => ns.map((n) => n.getAttribute('aria-label')));
    log('  sliders present: ' + JSON.stringify(sliders));
    await ctx.close(); await browser.close(); process.exit(1);
  }
  await wheel.focus();

  const rows = [];
  let pressed = 0;
  for (const day of DAY_STEPS) {
    while (pressed < day) { await page.keyboard.press('PageUp'); pressed++; await page.waitForTimeout(1200); }
    await page.waitForTimeout(9000);   // let the marine hour re-commit
    const aria = await page.evaluate(() => {
      const n = document.querySelector('[role="slider"][aria-label*="Forecast timeline"]');
      return n ? { now: n.getAttribute('aria-valuenow'), text: n.getAttribute('aria-valuetext') } : null;
    });
    const probes = {};
    for (const p of SWELL_PROBES) {
      probes[p.id] = await page.evaluate(readSwell,
        { c: [TARGET.center[0] + p.d[0], TARGET.center[1] + p.d[1]] });
    }
    const okP = SWELL_PROBES.map((p) => probes[p.id]).filter((x) => x.ok);
    let agg = null;
    if (okP.length) {
      let ss = 0, cc = 0;
      for (const x of okP) { const r = x.dirDeg * Math.PI / 180; ss += Math.sin(r); cc += Math.cos(r); }
      agg = Math.atan2(ss, cc) * 180 / Math.PI; if (agg < 0) agg += 360;
      agg = +agg.toFixed(1);
    }
    const s = okP.length ? { ok: true, dirDeg: agg, gridFingerprint: okP[0].gridFingerprint,
      nx: okP[0].nx, ny: okP[0].ny } : { ok: false, why: 'every offshore probe null' };
    rows.push({ day, aria, swell: s, probes });
    log(`day +${day}  aria-valuenow=${aria && aria.now}  grid=${okP.length ? okP[0].nx + 'x' + okP[0].ny : '?'}`
      + `  swellDir=${s.ok ? s.dirDeg + ' deg' : 'ERR ' + s.why}  gridFp=${s.ok ? s.gridFingerprint : '-'}`);
    log(`         per-probe: ` + SWELL_PROBES.map((p) =>
      `${p.id}=${probes[p.id].ok ? probes[p.id].dirDeg : 'null'}`).join('  '));
  }
  await ctx.close(); await browser.close();

  const good = rows.filter((r) => r.swell.ok);
  log('');
  if (good.length < 2) { log('=> INSUFFICIENT: fewer than 2 readable steps. Cannot judge range.'); }
  else {
    const dirs = good.map((r) => r.swell.dirDeg);
    const fps = [...new Set(good.map((r) => r.swell.gridFingerprint))];
    // circular range
    let maxSep = 0;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        let d = Math.abs(dirs[i] - dirs[j]) % 360; if (d > 180) d = 360 - d;
        if (d > maxSep) maxSep = d;
      }
    }
    const ariaMoved = [...new Set(rows.map((r) => r.aria && r.aria.now))].length > 1;
    log(`directions: ${dirs.join(', ')}`);
    log(`distinct grid fingerprints: ${fps.length} of ${good.length}  (1 => the marine data NEVER re-committed)`);
    log(`aria-valuenow moved: ${ariaMoved}`);
    log(`max circular separation: ${maxSep.toFixed(1)} deg`);
    log('');
    if (!ariaMoved) log('=> VOID: the scrubber never moved. Not a statement about swell.');
    else if (fps.length < 2) log('=> VOID: the resident wave grid never changed. The hour moved but the DATA did not.');
    else if (maxSep < 20) log(`=> NO LEVERAGE: swell direction spans only ${maxSep.toFixed(1)} deg. A rotation test on this driver cannot discriminate; do NOT run it and do NOT report a null as evidence.`);
    else log(`=> GO: ${maxSep.toFixed(1)} deg of swell rotation available. The arc-rotation test is worth running.`);
  }
  fs.writeFileSync(path.join(outdir, 'swell-range-probe.json'), JSON.stringify({ rows }, null, 1));
  log('written: ' + path.join(outdir, 'swell-range-probe.json'));
})().catch((e) => { console.error(e); process.exit(1); });

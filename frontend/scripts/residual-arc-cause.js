/**
 * residual-arc-cause.js — what causes the RESIDUAL arc (§27a), the part the island re-assert does
 * NOT explain? Runs BOTH candidate tests in one page load.
 *
 * THE RESIDUAL. With the island re-assert fully disabled, ~21% of bearings stay suppressed
 * (a0 ~0.05-0.10) — suppressed in AMPLITUDE but NOT displaced (offset>2px = 0.000 in both OFF legs).
 * Two candidates:
 *   (A) SHELTERING physics       -> tied to SWELL DIRECTION    -> the arc ROTATES with the swell
 *   (B) EMPTY/LAND GRID CELLS    -> tied to the WAVE GRID      -> the arc sits where the cells are empty
 *
 * TEST 1 (direct, tests B on its own terms). The resident grid is only 8x8 over ~2 deg. For each
 * bearing, walk OUT along the ray in geographic space and count how many sampled points land in a
 * grid cell that is EMPTY (u==0 && v==0, or no cell). Correlate that per-bearing count against the
 * per-bearing a0. (B) predicts suppressed bearings have more empty cells; a flat count across
 * bearings while a0 varies REFUTES (B).
 *   ⚠️ This also settles a question I had to RETRACT: whether the island's own cells are actually
 *   empty was never established — an earlier reading came from a broken cell[0]/cell[1] accessor
 *   that returned null for every cell, land or water. Here it is measured with the real
 *   { u, v, speed, lat, lng } shape (GridParserWorker.js:72-86).
 *
 * TEST 2 (the rotation test, at usable resolution). Measured leverage is only ~19-31 deg of swell
 * rotation between day 0 and day +4 (stable N/E probes: N 200.4 -> 169.9, E 200.1 -> 181.4), so at
 * the previous 24 bearings (15 deg apart) the arc could move at most 1-2 bins — underpowered. At
 * 48 BEARINGS (7.5 deg) a ~30 deg rotation is ~4 bins and becomes detectable. Both days are measured
 * with the SAME geometry, so (A) predicts the arc centre shifts with the swell and (B) predicts it
 * does not move at all.
 *   ⛔ A null here is only meaningful BECAUSE the leverage was measured first. It is reported
 *   alongside the observed swell delta so it can never be read as "no rotation" when the driver
 *   simply did not turn.
 *
 * The island re-assert is DISABLED throughout, so the confirmed §27 cause is removed and only the
 * residual remains. Basemap water is forced red and alpha is read off G (the channel the backdrop
 * zeroes) — never R, which in BEACH theme the warm field RAISES.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'residual-arc-cause-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[arc] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const BEARINGS = 48;                       // 7.5 deg bins — needed to resolve a ~30 deg rotation
const CELL_SAMPLE_DEG = [0.05, 0.10, 0.15, 0.20, 0.30, 0.40];
const FORCED_WATER = '#ff0000';
const DAYS = [0, 4];                       // the two ends of the measured swell range

// ── per-bearing field alpha at the basemap shoreline (G channel) ───────────────
const measureAlpha = ({ center, rayDeg, bearings }) => new Promise((resolve) => {
  const m = window.map;
  const fn = () => {
    m.off('render', fn);
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
    const img = c2.getImageData(0, 0, cv.width, cv.height).data;
    const waterIds = (() => {
      try {
        const ids = (m.getStyle().layers || []).filter((l) => l['source-layer'] === 'water' || l.id === 'water')
          .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
        return ids.length ? ids : ['water'];
      } catch (e) { return ['water']; }
    })();
    const out = [];
    for (let b = 0; b < bearings; b++) {
      const th = (b / bearings) * 2 * Math.PI;
      const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
        center[1] + rayDeg * Math.cos(th)];
      const p0 = m.project(center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const nDev = Math.max(8, Math.round(Math.hypot(dx, dy) * dpr));
      const at = (i) => ({ cx: p0.x + dx * i / nDev, cy: p0.y + dy * i / nDev });
      const okv = (cx, cy) => cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
        && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
      const water = [];
      const isWater = (i) => {
        if (water[i] !== undefined) return water[i];
        const { cx, cy } = at(i);
        if (!okv(cx, cy)) { water[i] = null; return null; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
        water[i] = w; return w;
      };
      let coast = -1;
      for (let i = 1; i + 8 <= nDev; i++) {
        if (isWater(i) !== true) continue;
        let ok = true;
        for (let k = 1; k < 8; k++) if (isWater(i + k) !== true) { ok = false; break; }
        if (ok) { coast = i; break; }
      }
      if (coast < 0) { out.push({ b, void: 'no_coast' }); continue; }
      const G = [];
      for (let d = 0; d + coast <= nDev; d++) {
        const { cx, cy } = at(coast + d);
        if (!okv(cx, cy)) break;
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) break;
        G.push(img[(Y * cv.width + X) * 4 + 1]);
      }
      if (G.length < 40) { out.push({ b, void: 'short_ray' }); continue; }
      const far = G.slice(Math.floor(G.length * 0.66)).slice().sort((x, y) => x - y);
      const gFar = far[Math.floor(far.length / 2)];
      if (gFar < 40) { out.push({ b, void: 'no_field', gFar }); continue; }
      out.push({ b, a0: +Math.max(0, Math.min(1.5, G[0] / gFar)).toFixed(3), gFar });
    }
    resolve(out);
  };
  m.on('render', fn); m.triggerRepaint();
});

// ── per-bearing EMPTY-CELL count in the resident wave grid ─────────────────────
const measureCells = ({ center, bearings, dists }) => {
  const e = window.__MARINE_ENGINE__;
  if (!e || !e._waveData) return { ok: false, why: 'no wave data' };
  const g = e._waveData.waveGrid || e._waveData;
  const vec = g.vectors;
  if (!vec || !vec.length) return { ok: false, why: 'no vectors' };
  const nearest = (lng, lat) => {
    let best = null, bestD = Infinity;
    for (let i = 0; i < vec.length; i++) {
      const c = vec[i];
      if (!c || typeof c.lat !== 'number') continue;
      const dd = (c.lng - lng) * (c.lng - lng) + (c.lat - lat) * (c.lat - lat);
      if (dd < bestD) { bestD = dd; best = c; }
    }
    return best;
  };
  const empty = (c) => !c || ((c.u === 0 && c.v === 0) || (typeof c.speed === 'number' && c.speed === 0));
  const rows = [];
  let totalEmpty = 0;
  for (let b = 0; b < bearings; b++) {
    const th = (b / bearings) * 2 * Math.PI;
    let n = 0;
    const seen = [];
    for (const dd of dists) {
      const lng = center[0] + dd * Math.sin(th) / Math.cos(center[1] * Math.PI / 180);
      const lat = center[1] + dd * Math.cos(th);
      const c = nearest(lng, lat);
      const isE = empty(c);
      if (isE) n++;
      seen.push(isE ? 1 : 0);
    }
    totalEmpty += n;
    rows.push({ b, emptyCount: n, pattern: seen.join('') });
  }
  const centreCell = nearest(center[0], center[1]);
  return { ok: true, rows, cols: g.cols, rows_: g.rows, nCells: vec.length,
    gridEmptyTotal: vec.filter((c) => empty(c)).length,
    centreCellEmpty: empty(centreCell), centreCell: centreCell || null, totalEmpty };
};

const readSwellNE = ({ c }) => {
  const e = window.__MARINE_ENGINE__;
  if (!e || !e._waveData) return null;
  const g = e._waveData.waveGrid || e._waveData;
  const vec = g.vectors; if (!vec) return null;
  const pick = (lng, lat) => {
    let best = null, bestD = Infinity;
    for (const cc of vec) {
      if (!cc || typeof cc.lat !== 'number') continue;
      const dd = (cc.lng - lng) * (cc.lng - lng) + (cc.lat - lat) * (cc.lat - lat);
      if (dd < bestD) { bestD = dd; best = cc; }
    }
    return best;
  };
  const dirOf = (cc) => {
    if (!cc || (cc.u === 0 && cc.v === 0)) return null;
    let d = Math.atan2(cc.u, cc.v) * 180 / Math.PI; if (d < 0) d += 360; return +d.toFixed(1);
  };
  return { N: dirOf(pick(c[0], c[1] + 0.55)), E: dirOf(pick(c[0] + 0.60, c[1])) };
};

const circMean = (degs) => {
  if (!degs.length) return null;
  let s = 0, c = 0;
  for (const d of degs) { const r = d * Math.PI / 180; s += Math.sin(r); c += Math.cos(r); }
  let m = Math.atan2(s, c) * 180 / Math.PI; if (m < 0) m += 360;
  return +m.toFixed(1);
};
const circDelta = (a, b) => { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return +d.toFixed(1); };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    window.__RAW_DISABLE_ISLAND_REASSERT__ = true;   // remove the CONFIRMED cause; leave the residual
  });
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
  await page.evaluate((col) => {
    const m = window.map;
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col); } catch (e) {}
      }
    }
  }, FORCED_WATER);
  await page.waitForTimeout(3000);

  const wheel = await page.$('[role="slider"][aria-label*="Forecast timeline"]');
  if (wheel) await wheel.focus();
  const results = [];
  let pressed = 0;
  for (const day of DAYS) {
    while (pressed < day) { await page.keyboard.press('PageUp'); pressed++; await page.waitForTimeout(1200); }
    await page.waitForTimeout(day === 0 ? 2000 : 10000);
    const reassert = await page.evaluate(() => (window.__RAW_GPU__ || {}).islandReassert || null);
    const alpha = await page.evaluate(measureAlpha, { center: TARGET.center, rayDeg: TARGET.rayDeg, bearings: BEARINGS });
    const cells = await page.evaluate(measureCells, { center: TARGET.center, bearings: BEARINGS, dists: CELL_SAMPLE_DEG });
    const swell = await page.evaluate(readSwellNE, { c: TARGET.center });
    const ok = alpha.filter((x) => x.a0 !== undefined);
    const suppressed = ok.filter((x) => x.a0 < 0.5);
    const arcCentre = circMean(suppressed.map((x) => x.b * 360 / BEARINGS));
    results.push({ day, reassert, alpha, cells, swell, arcCentre, nOk: ok.length, nSup: suppressed.length });
    log(`day +${day}  reassert.applied=${reassert && reassert.applied}  rays=${ok.length}/${BEARINGS}`
      + `  suppressed=${suppressed.length}  arcCentre=${arcCentre} deg  swell N=${swell && swell.N} E=${swell && swell.E}`);
    if (cells.ok) log(`         grid ${cells.cols}x${cells.rows_} (${cells.nCells} cells), EMPTY total=${cells.gridEmptyTotal}`
      + `, centre cell empty=${cells.centreCellEmpty}`);
    else log(`         cells: ERR ${cells.why}`);
  }
  await ctx.close(); await browser.close();

  const d0 = results[0], d4 = results[1];
  log('');
  log('TEST 1 — does EMPTY-CELL COUNT explain the suppression?');
  if (!d0.cells.ok) log('  cells unreadable — test void');
  else {
    const byB = Object.fromEntries(d0.cells.rows.map((r) => [r.b, r.emptyCount]));
    const pairs = d0.alpha.filter((x) => x.a0 !== undefined).map((x) => ({ b: x.b, a0: x.a0, e: byB[x.b] }));
    const supE = pairs.filter((p) => p.a0 < 0.5).map((p) => p.e);
    const unsE = pairs.filter((p) => p.a0 >= 0.5).map((p) => p.e);
    const avg = (a) => (a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null);
    // Pearson r between a0 and empty-count
    const n = pairs.length, ma = avg(pairs.map((p) => p.a0)), me = avg(pairs.map((p) => p.e));
    let num = 0, da = 0, de = 0;
    for (const p of pairs) { num += (p.a0 - ma) * (p.e - me); da += (p.a0 - ma) ** 2; de += (p.e - me) ** 2; }
    const r = (da > 0 && de > 0) ? +(num / Math.sqrt(da * de)).toFixed(3) : null;
    log(`  grid EMPTY cells overall            : ${d0.cells.gridEmptyTotal} of ${d0.cells.nCells}`);
    log(`  island CENTRE cell empty            : ${d0.cells.centreCellEmpty}`);
    log(`  mean empty-count, SUPPRESSED bearings: ${avg(supE)}  (n=${supE.length})`);
    log(`  mean empty-count, NORMAL bearings    : ${avg(unsE)}  (n=${unsE.length})`);
    log(`  Pearson r (a0 vs empty-count)        : ${r}`);
    if (d0.cells.gridEmptyTotal === 0) {
      log('  => (B) REFUTED AT SOURCE: the grid contains NO empty cells at all, so interpolation-toward-empty');
      log('     cannot be suppressing anything. The retracted "island cells are land-zeroed" reading is now');
      log('     positively disproven, not merely unsupported.');
    } else if (r !== null && r < -0.4) {
      log('  => (B) SUPPORTED: suppression tracks empty-cell count (negative r = more empty, lower alpha).');
    } else if (r !== null && Math.abs(r) < 0.2) {
      log('  => (B) REFUTED: empty-cell count does not predict which bearings are suppressed.');
    } else log('  => INCONCLUSIVE.');
  }

  log('');
  log('TEST 2 — does the arc ROTATE with the swell?');
  const sw0 = d0.swell, sw4 = d4.swell;
  const swDelta = (sw0 && sw4 && sw0.N !== null && sw4.N !== null) ? circDelta(sw0.N, sw4.N) : null;
  log(`  swell N: ${sw0 && sw0.N} -> ${sw4 && sw4.N}   E: ${sw0 && sw0.E} -> ${sw4 && sw4.E}   delta=${swDelta} deg`);
  log(`  arc centre: ${d0.arcCentre} -> ${d4.arcCentre} deg`);
  const arcDelta = (d0.arcCentre !== null && d4.arcCentre !== null) ? circDelta(d0.arcCentre, d4.arcCentre) : null;
  log(`  arc delta = ${arcDelta} deg   (bearing resolution ${(360 / BEARINGS).toFixed(1)} deg)`);
  if (swDelta === null || arcDelta === null) log('  => VOID: missing a reading.');
  else if (swDelta < 15) log(`  => VOID: the swell only turned ${swDelta} deg. A null here says nothing about rotation.`);
  else if (arcDelta <= 360 / BEARINGS) log(`  => (A) REFUTED: swell turned ${swDelta} deg, the arc moved <= one bin. The arc is NOT tied to swell.`);
  else if (Math.abs(arcDelta - swDelta) < swDelta * 0.5) log(`  => (A) SUPPORTED: the arc tracked the swell (${arcDelta} vs ${swDelta} deg).`);
  else log(`  => PARTIAL: arc moved ${arcDelta} deg vs swell ${swDelta} deg — not a clean match either way.`);

  fs.writeFileSync(path.join(outdir, 'residual-arc-cause.json'), JSON.stringify({ target: TARGET, bearings: BEARINGS, results }, null, 1));
  log('');
  log('written: ' + path.join(outdir, 'residual-arc-cause.json'));
})().catch((e) => { console.error(e); process.exit(1); });

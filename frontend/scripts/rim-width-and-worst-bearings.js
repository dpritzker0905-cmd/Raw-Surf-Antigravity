/**
 * rim-width-and-worst-bearings.js — two questions in one pass.
 *
 * (1) RESOLVE THE RIM-WIDTH TENSION. The pale rim reads ~10 CSS px (~20 device px) on the ladder
 *     frames, but the mask's own alpha transition measures 2.2-3.6 device px from 10% to 90%. A
 *     3 px edge cannot look 20 px wide, so the two are not measuring the same thing and one of them
 *     is not the halo the owner sees.
 *
 *     THE TEST: the basemap may draw its OWN pale coastal band, present whether or not the field is
 *     on. Capture the same camera with Waves ON and OFF and measure, PER RAY, the width of the band
 *     adjacent to the coast in each:
 *         band present in OFF too, similar width  => it is BASEMAP STYLING, not our halo, and the
 *                                                    "~10 px rim" was never ours to fix
 *         band only in ON                         => it is ours, and the 3 px alpha edge is the
 *                                                    wrong statistic for it
 *
 * (2) FIND THE WORST BEARINGS. Median offset is 2.3-3.6 px but the spread across bearings is
 *     52-79 px, so the defect is a few coastal SEGMENTS, not a ring. Dump per-bearing crossings from
 *     the mask-debug alpha, sort, and unproject the worst to coordinates so the next investigation
 *     compares mask against basemap AT THOSE PLACES instead of over the whole coast — every
 *     whole-coast statistic so far has hidden this.
 *
 * Per ray throughout. Guardrail disabled. Madeira, the one target that reproduces.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RW_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'rim-width-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[rim] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const HOME = [-16.92, 32.74];
const Z = 9.30, RAY = 0.45, BEARINGS = 24;

/** Per-ray colour profile seaward of the point-truth shoreline, plus each sample's lng/lat. */
const profile = ({ center, rayDeg, bearings, maxD }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const rays = [];
      for (let b = 0; b < bearings; b++) {
        const th = (b / bearings) * 2 * Math.PI;
        const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
          center[1] + rayDeg * Math.cos(th)];
        const p0 = m.project(center), p1 = m.project(dest);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
        const water = [];
        for (let i = 0; i <= n; i++) {
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const vis = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
            && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
          let w = null;
          if (vis) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
          water.push(w);
        }
        let coast = -1;
        for (let i = 1; i + 8 <= n; i++) {
          if (water[i] !== true) continue;
          let ok = true; for (let k = 0; k < 8; k++) if (water[i + k] !== true) { ok = false; break; }
          if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
        }
        if (coast < 0) { rays.push({ b, void: 'no transition' }); continue; }
        const cols = [];
        for (let d = 0; d <= maxD; d++) {
          const i = coast + d; if (i > n || water[i] !== true) break;
          cols.push(px(p0.x + dx * i / n, p0.y + dy * i / n));
        }
        const ll = m.unproject([p0.x + dx * coast / n, p0.y + dy * coast / n]);
        rays.push({ b, coast, coastLng: +ll.lng.toFixed(5), coastLat: +ll.lat.toFixed(5), cols });
      }
      resolve({ rays });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // ISLAND RE-ASSERT A/B (2026-08-17). reassertNeLand multiplies the pristine Natural Earth mask
  // back over the basemap-painted one (mask * NE / 255), so NE land FORCES mask land regardless of
  // what the basemap says. NE 10m is generalized, so wherever its coastline bulges seaward of the
  // real one the field is masked off — a seaward displacement, worst on intricate coastline, which
  // is exactly the NE-to-E cluster measured at Madeira. Gated on mask density < 1200 px/deg; the
  // overlay canvas caps at 2048 over 2.409 deg = ~850, so it is ENABLED here.
  const REASSERT_OFF = process.env.RW_REASSERT_OFF === '1';
  // PROPOSED FIX, tested BEFORE changing code: the gate is already window-overridable, so the
  // candidate constant can be A/B'd on the deployed build. The re-assert's own Abaco forensics were
  // taken at a z9 mask of 205 px/deg; this overlay runs at ~850 px/deg (2048 canvas over 2.409 deg),
  // 4x finer, yet the <1200 gate still fires. 400 keeps the validated coarse-mask cases (205, and
  // world masks at ~11) and stops it firing on the fine overlay.
  const MAXD = process.env.RW_MAXDENSITY ? Number(process.env.RW_MAXDENSITY) : null;
  await page.addInitScript(({ off, maxd }) => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    if (off) window.__RAW_DISABLE_ISLAND_REASSERT__ = true;
    if (maxd) window.__RAW_ISLAND_REASSERT_MAX_DENSITY__ = maxd;
  }, { off: REASSERT_OFF, maxd: MAXD });
  console.log('[rim] leg: island re-assert ' + (REASSERT_OFF ? 'DISABLED' : 'enabled')
    + (MAXD ? ` | MAX_DENSITY override = ${MAXD}` : ' (stock — code default 400)'));
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
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);

  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: HOME, z: Z });
  await page.waitForTimeout(14000);
  await page.screenshot({ path: path.join(outdir, 'RIM_waves_on.png') });
  const ON = await page.evaluate(profile, { center: HOME, rayDeg: RAY, bearings: BEARINGS, maxD: 80 });
  const modeOn = await page.evaluate(() => (window.__RAW_GPU__.overlayMask || {}).reason);

  await setWaves(false); await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(outdir, 'RIM_waves_off.png') });
  const OFF = await page.evaluate(profile, { center: HOME, rayDeg: RAY, bearings: BEARINGS, maxD: 80 });
  await setWaves(true);

  // ── (1) rim width per ray, in BOTH legs, by the same rule ──────────────────────────────────
  // The "band" is the run adjacent to the coast whose colour differs from this ray's OWN far-water
  // colour by more than TOL. Applied identically to ON and OFF, so the comparison is like-for-like.
  const TOL = 14;
  const d3 = (p, q) => (!p || !q) ? 0 : Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
  const bandWidth = (cols) => {
    if (!cols || cols.length < 40) return null;
    const far = cols.slice(-20).filter(Boolean);
    if (!far.length) return null;
    const ref = [0, 1, 2].map((k) => Math.round(far.reduce((s, p) => s + p[k], 0) / far.length));
    let w = 0;
    for (let i = 0; i < cols.length; i++) { if (!cols[i] || d3(cols[i], ref) <= TOL) break; w++; }
    return w;
  };
  const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const onW = ON.rays.filter((r) => !r.void).map((r) => bandWidth(r.cols));
  const offW = OFF.rays.filter((r) => !r.void).map((r) => bandWidth(r.cols));
  log(`mode=${modeOn}`);
  log(`band width per ray (device px)  ON  median ${med(onW)}  n=${onW.filter(Number.isFinite).length}`);
  log(`band width per ray (device px)  OFF median ${med(offW)}  n=${offW.filter(Number.isFinite).length}`);
  const onM = med(onW), offM = med(offW);
  log(onM !== null && offM !== null && offM >= onM * 0.6
    ? '=> THE BAND IS PRESENT WITH WAVES OFF TOO — it is BASEMAP coastal styling, not the marine halo.'
    : '=> the band is substantially WIDER with waves on — it is ours.');

  // ── (2) worst bearings ─────────────────────────────────────────────────────────────────────
  // Per ray, where does the FIELD actually begin, relative to the basemap shoreline? Use the ON
  // leg's own far-water colour as the field reference and the OFF leg's same-sample colour as the
  // basemap reference, so this is the field's own onset, not a mask proxy.
  const worst = [];
  for (const r of ON.rays) {
    if (r.void) continue;
    const off = OFF.rays.find((x) => x.b === r.b);
    if (!off || off.void || !r.cols || !off.cols) continue;
    const far = r.cols.slice(-20).filter(Boolean);
    if (!far.length) continue;
    const fieldRef = [0, 1, 2].map((k) => Math.round(far.reduce((s, p) => s + p[k], 0) / far.length));
    let onset = null;
    for (let i = 0; i < r.cols.length; i++) {
      const c = r.cols[i], b = off.cols[i];
      if (!c) break;
      // field has arrived when this pixel is closer to the field colour than to the bare basemap
      if (b && d3(c, fieldRef) < d3(c, b)) { onset = i; break; }
    }
    worst.push({ b: r.b, bearingDeg: Math.round((r.b / BEARINGS) * 360), onset,
      lng: r.coastLng, lat: r.coastLat });
  }
  const scored = worst.filter((w) => Number.isFinite(w.onset)).sort((a, b) => b.onset - a.onset);
  log('');
  log(`field onset seaward of the basemap shoreline — median ${med(scored.map((s) => s.onset))} px, `
    + `n=${scored.length}`);
  log('WORST BEARINGS (largest onset = field starts furthest out):');
  for (const s of scored.slice(0, 6)) {
    log(`   bearing ${String(s.bearingDeg).padStart(3)}deg  onset ${String(s.onset).padStart(3)} px  at ${s.lat}, ${s.lng}`);
  }
  log('BEST bearings for contrast:');
  for (const s of scored.slice(-3)) {
    log(`   bearing ${String(s.bearingDeg).padStart(3)}deg  onset ${String(s.onset).padStart(3)} px  at ${s.lat}, ${s.lng}`);
  }

  fs.writeFileSync(path.join(outdir, 'rim-width-and-worst-bearings.json'),
    JSON.stringify({ base: BASE, home: HOME, z: Z, modeOn, tol: TOL,
      bandWidthOnMedian: onM, bandWidthOffMedian: offM, perBearing: scored }, null, 1));
  log('written: ' + path.join(outdir, 'rim-width-and-worst-bearings.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

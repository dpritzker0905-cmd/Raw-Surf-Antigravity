/**
 * mask-bounds-staleness.js — is the mask's coast offset a BOUNDS/STALENESS error, or in the paint?
 *
 * MEASURED: the mask's coast sits ~6 device px seaward of the basemap's (median bearing) and
 * scatters ~48 px across bearings; each ray's own edge is crisp (~4 px); and the polygon rings the
 * painter is handed are correct to within 1 px on 24/24 bearings. So the displacement enters after
 * the geometry — either the rasterisation, or the BOUNDS the finished texture is sampled with.
 *
 * THE DISCRIMINATOR. A mask is geo-referenced by its bounds. If the texture and its bounds agree,
 * the coast lands correctly no matter where the camera is; the offset would then be a property of
 * the PAINT and invariant under camera motion. If they disagree, the sampled coast shifts with the
 * camera while the texture is REUSED (the engine's repaint hysteresis deliberately reuses a mask
 * inside its truth box), and snaps back when a repaint lands. So:
 *
 *     offset DRIFTS with camera motion while the paint timestamp is unchanged, and SNAPS BACK on
 *     repaint                                    => bounds / staleness mismatch
 *     offset INVARIANT across cameras            => the paint itself
 *
 * `__RAW_GPU__.basemapWaterMask.at` is the paint timestamp and `.bounds` / `.truthBox` are what it
 * was painted for — so "did a repaint happen between these two readings" is READ, not assumed.
 *
 * WHY NO MATTING IS NEEDED HERE. Crossing POSITION does not need absolute alpha, only monotonicity.
 * In `__GPU_DEBUG__={mode:'mask'}` the pixel is oceanAlpha-grey composited over the basemap; with
 * the basemap water forced to a flat colour, the background is CONSTANT along the water half of each
 * ray, so the composite is a monotone function of oceanAlpha and its 10/50/90 crossings are
 * oceanAlpha's. One capture per camera instead of four.
 *
 * Per ray throughout — a mean over bearings turns displacement variance into a fake ramp, which is
 * the artifact that cost this investigation seven rounds.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.MB_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'mask-bounds-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[bounds] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const HOME = [-16.92, 32.74];
const Z = 9.30;
const RAY = 0.45;
const FORCED_WATER = '#ff0000';
// small pans, all well inside a padded truth box, then a deliberate repaint trigger at the end
const STEPS = [
  { id: 'home',            center: HOME,                          note: 'baseline' },
  { id: 'pan_E_0.05',      center: [HOME[0] + 0.05, HOME[1]],     note: 'inside truth box' },
  { id: 'pan_E_0.10',      center: [HOME[0] + 0.10, HOME[1]],     note: 'inside truth box' },
  { id: 'pan_N_0.10',      center: [HOME[0], HOME[1] + 0.10],     note: 'inside truth box' },
  { id: 'home_again',      center: HOME,                          note: 'back to baseline' },
  { id: 'far_then_home',   center: HOME, forceRepaint: true,      note: 'after a big excursion -> repaint' },
];

/** Per-ray 10/50/90 crossings of the mask profile, measured from the POINT-truth shoreline. */
const measure = ({ center, rayDeg }) => {
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
      const lum = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4;
        return 0.2126 * img[o] + 0.7152 * img[o + 1] + 0.0722 * img[o + 2];
      };
      const stats = [];
      for (let b = 0; b < 24; b++) {
        const th = (b / 24) * 2 * Math.PI;
        const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
          center[1] + rayDeg * Math.cos(th)];
        const p0 = m.project(center), p1 = m.project(dest);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
        const water = [], val = [];
        for (let i = 0; i <= n; i++) {
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const vis = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
            && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
          let w = null;
          if (vis) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
          water.push(w); val.push(vis ? lum(cx, cy) : null);
        }
        let coast = -1;
        for (let i = 1; i + 8 <= n; i++) {
          if (water[i] !== true) continue;
          let ok = true; for (let k = 0; k < 8; k++) if (water[i + k] !== true) { ok = false; break; }
          if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
        }
        if (coast < 0) continue;
        // water half only: background is the forced flat colour there, so luminance is monotone in oceanAlpha
        const prof = [];
        for (let i = coast; i <= n && water[i] === true; i++) if (val[i] !== null) prof.push({ d: i - coast, v: val[i] });
        if (prof.length < 8) continue;
        const lo = prof[0].v, hi = prof[prof.length - 1].v;
        if (Math.abs(hi - lo) < 12) { stats.push({ b, cross50: null, note: 'flat ray' }); continue; }
        const at = (frac) => {
          const t = lo + frac * (hi - lo);
          for (let i = 1; i < prof.length; i++) {
            const p = prof[i - 1], q = prof[i];
            if ((q.v >= t && p.v < t) || (q.v <= t && p.v > t)) {
              return p.d + (q.d - p.d) * ((t - p.v) / ((q.v - p.v) || 1e-6));
            }
          }
          return prof[prof.length - 1].d;
        };
        stats.push({ b, cross10: +at(0.1).toFixed(1), cross50: +at(0.5).toFixed(1), cross90: +at(0.9).toFixed(1) });
      }
      const g = window.__RAW_GPU__ || {};
      const bw = g.basemapWaterMask || {};
      resolve({
        stats,
        paintAt: bw.at || null,
        paintBounds: bw.bounds ? { w: +bw.bounds.west.toFixed(4), e: +bw.bounds.east.toFixed(4) } : null,
        truthBox: bw.truthBox ? { w: +bw.truthBox.west.toFixed(4), e: +bw.truthBox.east.toFixed(4) } : null,
        overlayBounds: (g.overlayMask && g.overlayMask.bounds)
          ? { w: +g.overlayMask.bounds.west.toFixed(4), e: +g.overlayMask.bounds.east.toFixed(4) } : null,
        mode: g.overlayMask ? g.overlayMask.reason : null,
        center: m.getCenter().toArray().map((v) => +v.toFixed(4)),
      });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    recordVideo: { dir: outdir, size: { width: 1280, height: 800 } } });
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
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);
  const setWater = (col) => page.evaluate((c) => {
    const m = window.map;
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', c === null ? undefined : c); } catch (e) {}
      }
    }
  }, col);
  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });

  // ── PHASE A: bounds / staleness ────────────────────────────────────────────────────────────
  log('=== PHASE A — bounds / staleness ===');
  await page.evaluate(() => { window.__GPU_DEBUG__ = { mode: 'mask' }; });
  await setWater(FORCED_WATER);
  const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? +v[Math.floor(v.length / 2)].toFixed(1) : null; };
  const phaseA = [];
  for (const st of STEPS) {
    if (st.forceRepaint) {   // big excursion then back: guarantees the hysteresis box is escaped
      await page.evaluate(() => window.map.jumpTo({ center: [-30, 40], zoom: 6 }));
      await page.waitForTimeout(9000);
    }
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: st.center, z: Z });
    await page.waitForTimeout(9000);
    await page.evaluate(() => { window.__GPU_DEBUG__ = { mode: 'mask' }; window.map.triggerRepaint(); });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(measure, { center: st.center, rayDeg: RAY });
    const c50 = r.stats.map((s) => s.cross50);
    const finite = c50.filter(Number.isFinite);
    const rec = { step: st.id, note: st.note, rays: finite.length,
      cross50med: med(c50),
      spread: finite.length > 1 ? +(Math.max(...finite) - Math.min(...finite)).toFixed(1) : null,
      widthMed: med(r.stats.map((s) => (Number.isFinite(s.cross90) && Number.isFinite(s.cross10)) ? s.cross90 - s.cross10 : null)),
      paintAt: r.paintAt, paintBounds: r.paintBounds, overlayBounds: r.overlayBounds, mode: r.mode };
    phaseA.push(rec);
    log(`${st.id.padEnd(15)} rays=${rec.rays} cross50med=${rec.cross50med}px spread=${rec.spread}px width=${rec.widthMed}px `
      + `mode=${rec.mode} paintAt=${String(rec.paintAt).slice(11, 19)} ovBounds=${rec.overlayBounds ? rec.overlayBounds.w + '..' + rec.overlayBounds.e : '-'}`);
  }
  const repaints = new Set(phaseA.map((r) => r.paintAt)).size;
  const offs = phaseA.map((r) => r.cross50med).filter(Number.isFinite);
  const offDrift = offs.length > 1 ? +(Math.max(...offs) - Math.min(...offs)).toFixed(1) : null;
  log('');
  log(`distinct mask paints across the ${phaseA.length} steps: ${repaints}`);
  log(`cross50 median DRIFT across cameras: ${offDrift} px`);
  log(offDrift !== null && offDrift <= 2
    ? '=> INVARIANT under camera motion — the offset is a property of the PAINT, not of bounds/staleness.'
    : '=> DRIFTS with the camera — consistent with a bounds/staleness mismatch.');

  // ── PHASE B: the visual record — normal render, real wheel ladder, on video ────────────────
  log('');
  log('=== PHASE B — visual: normal render, real wheel zoom ladder ===');
  await page.evaluate(() => { window.__GPU_DEBUG__ = { mode: null }; });
  await setWater(null);
  await page.evaluate(({ c }) => window.map.jumpTo({ center: c, zoom: 11 }), { c: HOME });
  await page.waitForTimeout(9000);
  await page.mouse.move(640, 400);
  const ladder = [];
  for (let stop = 0; stop < 6; stop++) {
    if (stop > 0) { for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(220); } }
    await page.waitForTimeout(7000);
    const z = await page.evaluate(() => +window.map.getZoom().toFixed(2));
    const f = path.join(outdir, `LADDER_${stop}_z${z}.png`);
    await page.screenshot({ path: f });
    ladder.push({ stop, z, file: path.basename(f) });
    log(`  ladder stop ${stop}: z=${z}`);
  }

  fs.writeFileSync(path.join(outdir, 'mask-bounds-staleness.json'),
    JSON.stringify({ base: BASE, home: HOME, z: Z, phaseA, distinctPaints: repaints, offDrift, ladder }, null, 1));
  log('written: ' + path.join(outdir, 'mask-bounds-staleness.json'));
  await ctx.close();      // flushes the video
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * coast-normal-onset.js — is the 255° residual a real defect, or ray obliquity?
 *
 * THE SUSPICION. Every onset in this arc was measured ALONG A RAY cast from the island centroid.
 * That is a perpendicular distance divided by cos(angle between the ray and the local coast normal),
 * so a coast that runs oblique to its ray inflates. 28 px along a ray meeting the coast at 70° is
 * only ~10 px perpendicular. Madeira's SW corner (bearing 255°, 32.69350 −17.12638) is exactly where
 * the coastline runs oblique to a centroid ray, and 255° is the one bearing NO lever ever moved —
 * both facts fit a metric artifact at least as well as a defect.
 *
 * ⛔ This is the same class as the mistake that cost seven rounds here (a mean over bearings faking
 * softness out of displacement): a statistic whose geometry is not the geometry of the thing being
 * measured. Check the metric before fixing the code.
 *
 * THE MEASUREMENT. At each probe point, estimate the LOCAL COAST NORMAL from basemap water truth —
 * sample a ring around the point, take the mean direction of the water samples — then measure the
 * field onset ALONG THAT NORMAL. Report both, plus the implied obliquity:
 *
 *     normal-onset ~= ray-onset * cos(obliquity)   =>  artifact
 *     normal-onset ~= ray-onset                    =>  real, and oblique geometry is not the story
 *
 * Probes: the 255° residual, the 75° bearing the re-assert fix repaired (must now read ~0 by BOTH
 * metrics — a control that the instrument is not simply reporting zero everywhere), and a bearing
 * that was always clean.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.CN_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'coast-normal-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[normal] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const HOME = [-16.92, 32.74], Z = 9.30;
const PROBES = [
  { id: 'residual_255', lng: -17.12638, lat: 32.69350, rayOnset: 28 },
  { id: 'repaired_75',  lng: -16.80684, lat: 32.76552, rayOnset: 55 },   // 55 pre-fix, ~0 after
  { id: 'clean_285',    lng: -17.26110, lat: 32.81689, rayOnset: 0 },
];

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
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);
  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: HOME, z: Z });
  await page.waitForTimeout(14000);

  const grab = () => page.evaluate(({ probes, home }) => {
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
        const isWater = (cx, cy) => {
          if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
          if ((document.elementFromPoint(cx, cy) || {}).tagName !== 'CANVAS') return null;
          try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
        };
        const out = [];
        for (const p of probes) {
          const c0 = m.project([p.lng, p.lat]);
          // local coast NORMAL: mean direction of water samples on a ring around the coast point
          const R = 14;   // CSS px — big enough to span the coastline, small enough to stay local
          let sx = 0, sy = 0, nW = 0, nL = 0;
          for (let a = 0; a < 72; a++) {
            const th = (a / 72) * 2 * Math.PI;
            const qx = c0.x + R * Math.cos(th), qy = c0.y + R * Math.sin(th);
            const w = isWater(qx, qy);
            if (w === true) { sx += Math.cos(th); sy += Math.sin(th); nW++; }
            else if (w === false) nL++;
          }
          if (nW < 6 || nL < 6) { out.push({ id: p.id, void: `ring not a coast (water ${nW}, land ${nL})` }); continue; }
          const mag = Math.hypot(sx, sy);
          if (mag < 0.15 * nW) { out.push({ id: p.id, void: 'no coherent normal (cove/spit)' }); continue; }
          const nx = sx / mag, ny = sy / mag;                 // unit vector pointing seaward
          const ray = { x: c0.x - m.project(home).x, y: c0.y - m.project(home).y };
          const rmag = Math.hypot(ray.x, ray.y) || 1;
          const cosObl = Math.abs((ray.x / rmag) * nx + (ray.y / rmag) * ny);

          // walk seaward along the NORMAL: find the shoreline, then the field onset
          const far = [];
          for (let d = 60; d <= 100; d++) { const c = px(c0.x + nx * d, c0.y + ny * d); if (c) far.push(c); }
          if (far.length < 10) { out.push({ id: p.id, void: 'no far-water reference' }); continue; }
          const fieldRef = [0, 1, 2].map((k) => Math.round(far.reduce((s, c) => s + c[k], 0) / far.length));
          let shore = null, onset = null;
          for (let d = -20; d <= 90; d++) {
            const w = isWater(c0.x + nx * d, c0.y + ny * d);
            if (shore === null && w === true) shore = d;
          }
          if (shore === null) { out.push({ id: p.id, void: 'no shoreline along the normal' }); continue; }
          const d3 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
          for (let d = shore; d <= 90; d++) {
            const c = px(c0.x + nx * d, c0.y + ny * d); if (!c) break;
            if (d3(c, fieldRef) <= 16) { onset = (d - shore) * dpr; break; }   // device px
          }
          out.push({ id: p.id, normalOnsetPx: onset, cosObliquity: +cosObl.toFixed(3),
            obliquityDeg: +(Math.acos(Math.min(1, cosObl)) * 180 / Math.PI).toFixed(1),
            ringWater: nW, ringLand: nL });
        }
        resolve(out);
      };
      m.on('render', fn); m.triggerRepaint();
    });
  }, { probes: PROBES, home: HOME });

  const res = await grab();
  log('probe            ray-onset   NORMAL-onset   obliquity   ray*cos(obl)   verdict');
  for (const r of res) {
    const p = PROBES.find((x) => x.id === r.id);
    if (r.void) { log(`${r.id.padEnd(16)} ${String(p.rayOnset).padStart(9)}   VOID: ${r.void}`); continue; }
    // ⛔ THE VERDICT COLUMN THIS REPLACES WAS WRONG. It compared each probe's STALE PRE-FIX ray
    // onset against a FRESH normal measurement, so it labelled the repaired 75° bearing "consistent
    // with obliquity" (its 55 px no longer exists) and called 4 px of noise at a clean bearing
    // "REAL". A verdict is only as good as the vintage of both numbers it compares.
    const pred = (r.cosObliquity !== undefined) ? +(p.rayOnset * r.cosObliquity).toFixed(1) : null;
    const BASELINE = 6;   // clean-bearing noise floor, measured: 4 px
    const artifact = r.normalOnsetPx !== null && r.normalOnsetPx <= BASELINE;
    log(`${r.id.padEnd(16)} ${String(p.rayOnset).padStart(9)}   ${String(r.normalOnsetPx).padStart(12)}   `
      + `${String(r.obliquityDeg + '°').padStart(9)}   ${String(pred).padStart(12)}   `
      + (r.normalOnsetPx === null ? 'no onset found'
        : artifact ? 'at/below the 6 px baseline — nothing here'
          : `REAL: ${r.normalOnsetPx} px perpendicular`));
  }
  fs.writeFileSync(path.join(outdir, 'coast-normal-onset.json'), JSON.stringify({ base: BASE, probes: PROBES, res }, null, 1));
  log('written: ' + path.join(outdir, 'coast-normal-onset.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * island-halo.js — the residual halo, measured AROUND ISLANDS rather than across a mainland coast.
 *
 * OWNER, 2026-08-16 (after LOP-0001/2/3 shipped): *"The land mask halo is still slightly visible.
 * It needs further refining. It's more visible on the islands."*
 *
 * WHY THE EARLIER MEASUREMENT MISSED IT. `coastband-ladder.js` casts straight E–W / N–S transects
 * and requires 20 sustained samples of land AND water to accept a land→water transition. On a small
 * island that floor is never met, so those rows returned `VOID_NO_TRANSITION` and were dropped —
 * at z7.5 and below, EVERY Grand Bahama row was voided. The reported "band = 0 px" was therefore
 * predominantly a MAINLAND result. The refusal was correct; the coverage was not.
 *
 * WHAT IS DIFFERENT ABOUT AN ISLAND, and why it is the right probe:
 *   - it has coast on every bearing, so a radial defect shows as a RING, not a strip;
 *   - it is small relative to the mask's texel, so under-resolution shows up here first;
 *   - both error directions are visible at once (mask too big ⇒ band of bare water; too small ⇒
 *     field bleeds inland), and on a mainland transect only one of them is in frame.
 *
 * ⚠️ ONE ELIMINATED HYPOTHESIS IS BACK IN SCOPE. LOP-0002 rejected "mask LINEAR filtering / texel
 * softness" because the texel measured 2.3 screen px against a 10–20 px band. That rejection was
 * scoped to the BIG band. A *slight* halo is exactly 1–3 px, so texel softness is not excluded for
 * THIS report — the rejection was about magnitude, not mechanism. Hence the edge-PROFILE metric
 * below: LINEAR filtering yields a soft RAMP over ~1–2 texels, whereas a displaced coastline yields
 * a hard STEP at the wrong place. Ramp vs step separates them without needing a zoom argument.
 *
 * PER RAY, cast from the island centroid outward on 24 bearings:
 *   band_px   — basemap WATER, seaward of the shoreline, that the field did not paint
 *   bleed_px  — basemap LAND, landward of the shoreline, wearing the field's colour
 *   edge_px   — how many samples the field's hue takes to cross from land value to open-water value
 *               (the ramp width; ~1 = a hard step)
 *
 * Guardrail disabled throughout — otherwise the renderer is swapped for raster tiles mid-run and
 * every number describes Open-Meteo instead of this codebase (measured, 2026-08-16).
 *
 *   node scripts/island-halo.js <outdir>
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.IH_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-halo-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[island-halo] ' + m);

// centre + a radius that clears the shore on every bearing. Mainland entry is the CONTROL: if the
// halo is island-specific it must be quiet here, and if it is not, the report is about coasts.
// `spanDeg` is the target's own width. Ray length and zoom are DERIVED from it, because a fixed
// pair cannot serve both Bimini (~0.05 deg) and Grand Bahama (~0.75 deg): the first run used one
// ray length for all five and Grand Bahama's rays never left the island (1 usable ray of 24, all
// NO_TRANSITION). The refusal was right; the parameter was wrong.
const TARGETS = [
  { id: 'bimini',      kind: 'island',   center: [-79.28, 25.72], spanDeg: 0.06 },
  { id: 'berry',       kind: 'island',   center: [-77.83, 25.63], spanDeg: 0.20 },
  { id: 'grand_bahama',kind: 'island',   center: [-78.66, 26.62], spanDeg: 0.75 },
  { id: 'nassau',      kind: 'island',   center: [-77.35, 25.05], spanDeg: 0.30 },
  { id: 'florida',     kind: 'mainland', center: [-80.10, 26.60], spanDeg: 0.30 },
];
const BEARINGS = 24;
// viewport_deg = 1280 CSS px / (512 * 2^z / 360) = 900 / 2^z. Frame each target at ~2.6x its own
// width, and cast rays to 0.85x its width so every ray clears the shore with margin.
const zoomFor = (spanDeg) => Math.min(12, Math.max(7, +Math.log2(900 / (spanDeg * 2.6)).toFixed(2)));
const ZOOM_STEPS = [0, -1, -2];        // native framing, then two levels out
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  const crumbs = [];
  page.on('console', (m) => { if (/\[rating-band\]|WebGLGuardrail/.test(m.text())) crumbs.push({ at: Date.now(), t: m.text().slice(0, 120) }); });

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  const build = await page.evaluate(async () => {
    try { const r = await fetch('/service-worker.js', { cache: 'no-store' }); const t = await r.text();
      const m = t.match(/BUILD_VERSION\s*=\s*'([^']+)'/); return m ? m[1] : '?'; } catch (e) { return '?'; }
  });
  log('build=' + build);
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some((b) => (b.textContent || '').trim() === 'Waves'), null, { timeout: 60000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });

  const rows = [];
  for (const step of ZOOM_STEPS) {
    for (const tgt of TARGETS) {
      const z = +(zoomFor(tgt.spanDeg) + step).toFixed(2);
      const rayDeg = tgt.spanDeg * 0.85;
      await page.evaluate(({ c, zz }) => window.map.jumpTo({ center: c, zoom: zz }), { c: tgt.center, zz: z });
      await page.waitForTimeout(9000);
      await page.evaluate(() => window.map.triggerRepaint());
      await page.waitForTimeout(1500);

      const r = await page.evaluate(async ({ tgt, bearings }) => {
        const m = window.map, g = window.__RAW_GPU__ || {};
        await new Promise((res) => { const fn = () => { m.off('render', fn); res(); }; m.on('render', fn); m.triggerRepaint(); });
        const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
        const dpr = src.width / rect.width;
        const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
        const c2 = cv.getContext('2d', { willReadFrequently: true });
        c2.drawImage(src, 0, 0);
        const img = c2.getImageData(0, 0, cv.width, cv.height).data;
        const waterIds = (() => {
          try {
            const ids = (m.getStyle().layers || [])
              .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
              .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
            return ids.length ? ids : ['water'];
          } catch (e) { return ['water']; }
        })();
        const bg = (c) => (c ? c[2] - c[1] : null);
        const px = (cx, cy) => {
          const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
          if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
          const o = (Y * cv.width + X) * 4;
          return [img[o], img[o + 1], img[o + 2]];
        };
        const rays = [];
        for (let b = 0; b < bearings; b++) {
          const th = (b / bearings) * 2 * Math.PI;
          const dest = [tgt.center[0] + tgt.rayDeg * Math.sin(th) / Math.cos(tgt.center[1] * Math.PI / 180),
            tgt.center[1] + tgt.rayDeg * Math.cos(th)];
          const p0 = m.project(tgt.center), p1 = m.project(dest);
          const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
          const cols = [], water = [], onScreen = [];
          for (let i = 0; i <= n; i++) {
            const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
            cols.push(px(cx, cy));
            const vis = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
              && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
            onScreen.push(vis);
            let w = null;
            if (vis) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
            water.push(w);
          }
          if (onScreen.filter(Boolean).length < n * 0.8) { rays.push({ b, void: 'OFFSCREEN' }); continue; }
          // shoreline = first index that starts a sustained WATER run (8 is enough on a ray that
          // leaves the island; 20 is what voided every island row in the transect harness)
          const RUN = 8;
          let coast = -1;
          for (let i = 1; i + RUN <= n; i++) {
            if (water[i] !== true) continue;
            let ok = true; for (let k = 0; k < RUN; k++) if (water[i + k] !== true) { ok = false; break; }
            if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
          }
          if (coast < 0) { rays.push({ b, void: 'NO_TRANSITION' }); continue; }
          // hue references: open water far out on this ray vs the land side
          const last = (() => { let i = coast; while (i <= n && water[i] === true) i++; return i - 1; })();
          const oa = Math.min(coast + 12, last), ob = Math.min(coast + 40, last);
          const openVals = [];
          for (let i = oa; i <= ob; i++) { const v = bg(cols[i]); if (Number.isFinite(v)) openVals.push(v); }
          const landVals = [];
          for (let i = Math.max(0, coast - 20); i < coast - 2; i++) { const v = bg(cols[i]); if (Number.isFinite(v)) landVals.push(v); }
          const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
          const openRef = med(openVals), landRef = med(landVals);
          if (openRef === null || landRef === null || Math.abs(openRef - landRef) < 12) {
            rays.push({ b, void: 'HUE_INSEPARABLE', openRef, landRef }); continue;
          }
          const cut = (openRef + landRef) / 2;
          const isFieldWater = (i) => { const v = bg(cols[i]); return v !== null && (openRef > landRef ? v >= cut : v <= cut); };
          let band = 0;
          for (let i = coast; i <= last; i++) { if (isFieldWater(i)) break; band++; }
          let bleed = 0;
          for (let i = coast - 1; i >= 0 && water[i] === false; i--) { if (!isFieldWater(i)) break; bleed++; }
          // ramp width: samples taken to go from 10% to 90% of the land→open swing
          const lo = landRef + 0.1 * (openRef - landRef), hi = landRef + 0.9 * (openRef - landRef);
          const between = (v) => (openRef > landRef ? (v > lo && v < hi) : (v < lo && v > hi));
          let edge = 0;
          for (let i = Math.max(0, coast - 6); i <= Math.min(last, coast + 20); i++) {
            const v = bg(cols[i]); if (v !== null && between(v)) edge++;
          }
          rays.push({ b, coast, band, bleed, edge, openRef, landRef });
        }
        return {
          z: +m.getZoom().toFixed(2), rays,
          overlayReason: g.overlayMask ? g.overlayMask.reason : null,
          overlayOn: g.overlayMask ? g.overlayMask.on : null,
          // FRESHNESS. The first run's signal counted [rating-band] breadcrumbs, which only fire
          // while Surf Rating is ON — it was off, so `fresh` read false at every stop and proved
          // nothing. Ask instead whether the renderer's own overlay bounds contain THIS camera:
          // bounds left over from the previous island are hundreds of km away and cannot.
          telemetryCoversHere: (() => {
            const b = g.overlayMask && g.overlayMask.bounds; const c = m.getCenter();
            if (!b) return null;
            return c.lng >= b.west && c.lng <= b.east && c.lat >= b.south && c.lat <= b.north;
          })(),
          maskTexelDeg: g.ribbon ? g.ribbon.maskTexelDeg : null,
          ribbon: g.ribbon || null,
          gridLegend: (() => { const el = [...document.querySelectorAll('*')].find((x) => x.children.length === 0 && /km grid/.test(x.textContent || '')); return el ? el.textContent.trim() : null; })(),
        };
      }, { tgt: { ...tgt, rayDeg }, bearings: BEARINGS });

      const fresh = r.telemetryCoversHere;     // overlay bounds contain THIS camera
      const good = r.rays.filter((x) => !x.void);
      const med = (a, f) => { const v = a.map(f).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
      const row = {
        zoom: z, rayDeg, target: tgt.id, kind: tgt.kind, z: r.z, fresh,
        overlayReason: r.overlayReason, grid: r.gridLegend,
        rays: r.rays.length, usable: good.length,
        bandMed: med(good, (x) => x.band), bandMax: good.length ? Math.max(...good.map((x) => x.band)) : null,
        bleedMed: med(good, (x) => x.bleed), bleedMax: good.length ? Math.max(...good.map((x) => x.bleed)) : null,
        edgeMed: med(good, (x) => x.edge),
        voids: r.rays.filter((x) => x.void).length,
      };
      rows.push({ ...row, detail: r });
      await page.screenshot({ path: path.join(outdir, `IH_${tgt.id}_z${z}.png`) });
      log(`z${z} ${tgt.id.padEnd(13)} ${tgt.kind.padEnd(9)} usable=${String(row.usable).padStart(2)}/${row.rays} `
        + `band med/max=${row.bandMed}/${row.bandMax}  bleed med/max=${row.bleedMed}/${row.bleedMax}  `
        + `edge=${row.edgeMed}  ovl=${row.overlayReason} fresh=${fresh}`);
    }
  }

  fs.writeFileSync(path.join(outdir, 'island-halo.json'),
    JSON.stringify({ base: BASE, build, targets: TARGETS, bearings: BEARINGS, rows }, null, 1));
  log('written: ' + path.join(outdir, 'island-halo.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

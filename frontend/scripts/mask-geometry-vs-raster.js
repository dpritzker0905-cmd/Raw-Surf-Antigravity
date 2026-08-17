/**
 * mask-geometry-vs-raster.js — is the mask's coast displaced by its GEOMETRY SOURCE, or by the
 * RASTERISATION?
 *
 * MEASURED SO FAR: the mask's coastline sits ~6 device px seaward of the basemap's on the median
 * bearing and scatters ~48 px across bearings, with each ray's edge crisp (~4 px). That is a
 * geometry disagreement. `overlayBasemapWaterOnMask` paints from `queryRenderedFeatures` on the very
 * water layers the basemap draws, so in principle the geometry is IDENTICAL and the coasts should
 * coincide. Two ways it can still diverge, needing opposite fixes:
 *
 *   H-GEOM   the returned POLYGON RINGS are simplified/clipped relative to what the basemap paints,
 *            so the coast is already wrong before any pixel is written  -> fix the query
 *   H-RASTER the rings are faithful but the canvas paint displaces them (fill rule, antialiasing,
 *            the black-then-white order, the class filter dropping a polygon) -> fix the paint
 *
 * THE DISCRIMINATOR, in-page and needing neither the engine handle nor the mask texture:
 *   A. POINT truth — walk each ray and ask `queryRenderedFeatures([x,y], {layers: waterLayers})`.
 *      This is what the basemap actually renders at that pixel, and it is the same oracle every
 *      earlier harness used for "the shoreline".
 *   B. POLYGON truth — take the SAME features `overlayBasemapWaterOnMask` would take
 *      (`queryRenderedFeatures({layers})`, no geometry arg), apply its OWN class filter, and
 *      point-in-polygon test each ray sample against the returned rings, projected exactly as
 *      makeMaskProjector does (Web Mercator).
 *
 * A and B disagreeing localises the defect to the GEOMETRY the painter is handed (H-GEOM).
 * A and B agreeing means the rings are faithful and the displacement is introduced downstream
 * (H-RASTER) — and then the paint, not the query, is what to change.
 *
 * Reported per ray so a mean cannot manufacture a ramp out of steps — the artifact that cost this
 * investigation seven rounds.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.MG_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'mask-geom-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[geom-vs-raster] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };

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
  await page.waitForTimeout(14000);

  const out = await page.evaluate(({ tgt }) => {
    const m = window.map;
    // ── the painter's own source + layer resolution, copied from overlayBasemapWaterOnMask ──
    let waterSource = 'composite', waterSourceLayer = 'water';
    try {
      const st = m.getStyle();
      const bw = st && st.layers && st.layers.find((l) => l.id === 'water');
      if (bw) { if (bw.source) waterSource = bw.source; if (bw['source-layer']) waterSourceLayer = bw['source-layer']; }
    } catch (e) {}
    const fillLayerIds = (m.getStyle().layers || [])
      .filter((l) => l.type === 'fill' && l.source === waterSource && l['source-layer'] === waterSourceLayer)
      .map((l) => l.id);
    // POINT oracle uses the same water layer ids every earlier harness used
    const pointLayerIds = (m.getStyle().layers || [])
      .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
      .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });

    const feats = fillLayerIds.length ? m.queryRenderedFeatures({ layers: fillLayerIds }) : [];
    // the painter's class filter, verbatim
    const rings = [];
    let skippedByClass = 0, polyCount = 0;
    for (const f of feats) {
      const cls = f.properties && f.properties.class;
      if (cls !== undefined && cls !== 'ocean' && cls !== 'sea') { skippedByClass++; continue; }
      const g = f.geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : null);
      if (!polys) continue;
      for (const poly of polys) { polyCount++; rings.push(poly); }
    }
    // even-odd point-in-polygon over a poly's rings (outer + holes), in lng/lat
    const inRing = (ring, x, y) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
      }
      return inside;
    };
    const inPolys = (lng, lat) => {
      for (const poly of rings) {
        if (!poly.length || !inRing(poly[0], lng, lat)) continue;
        let hole = false;
        for (let h = 1; h < poly.length; h++) if (inRing(poly[h], lng, lat)) { hole = true; break; }
        if (!hole) return true;          // inside outer, not in a hole => WATER per the polygons
      }
      return false;
    };

    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const rays = [];
    for (let b = 0; b < 24; b++) {
      const th = (b / 24) * 2 * Math.PI;
      const dest = [tgt.center[0] + tgt.rayDeg * Math.sin(th) / Math.cos(tgt.center[1] * Math.PI / 180),
        tgt.center[1] + tgt.rayDeg * Math.cos(th)];
      const p0 = m.project(tgt.center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
      const pt = [], pg = [];
      for (let i = 0; i <= n; i++) {
        const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
        const vis = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
          && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
        if (!vis) { pt.push(null); pg.push(null); continue; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: pointLayerIds }).length > 0; } catch (e) {}
        pt.push(w);
        const ll = m.unproject([cx, cy]);
        pg.push(inPolys(ll.lng, ll.lat));
      }
      const firstRun = (arr, val, run) => {
        for (let i = 1; i + run <= n; i++) {
          if (arr[i] !== val) continue;
          let ok = true; for (let k = 0; k < run; k++) if (arr[i + k] !== val) { ok = false; break; }
          if (ok && arr.slice(0, i).some((x) => x === !val)) return i;
        }
        return -1;
      };
      rays.push({ b, coastPoint: firstRun(pt, true, 8), coastPoly: firstRun(pg, true, 8) });
    }
    return { waterSource, waterSourceLayer, fillLayerIds, pointLayerIds,
      featureCount: feats.length, polyCount, skippedByClass,
      overlayReason: (window.__RAW_GPU__.overlayMask || {}).reason, rays };
  }, { tgt: TARGET });

  const paired = out.rays.filter((r) => r.coastPoint >= 0 && r.coastPoly >= 0);
  const deltas = paired.map((r) => r.coastPoly - r.coastPoint);
  const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  log(`mode=${out.overlayReason} source=${out.waterSource}/${out.waterSourceLayer}`);
  log(`fill layers=${out.fillLayerIds.join(',') || 'NONE'}  features=${out.featureCount}  polys=${out.polyCount}  skippedByClass=${out.skippedByClass}`);
  log(`rays with BOTH a point-coast and a polygon-coast: ${paired.length}/24`);
  if (paired.length) {
    log(`polygon-coast MINUS point-coast (device px):  median ${med(deltas)}  min ${Math.min(...deltas)}  max ${Math.max(...deltas)}`);
    log(`  per ray: ${paired.map((r) => (r.coastPoly - r.coastPoint)).join(', ')}`);
    log(med(deltas) !== null && Math.abs(med(deltas)) <= 2
      ? '=> A and B AGREE: the rings are faithful; the displacement is introduced DOWNSTREAM (H-RASTER).'
      : '=> A and B DISAGREE: the geometry handed to the painter is already displaced (H-GEOM).');
  } else {
    log('=> VOID: no ray produced both a point-coast and a polygon-coast — refusing to conclude.');
  }
  fs.writeFileSync(path.join(outdir, 'mask-geometry-vs-raster.json'), JSON.stringify({ base: BASE, target: TARGET, out }, null, 1));
  log('written: ' + path.join(outdir, 'mask-geometry-vs-raster.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * halo-value-vs-colour.js — is the island rim the RENDERER fading the field, or the DATA being
 * genuinely smaller near shore?
 *
 * Measured so far: the field's tint ramps from ~40% at the shoreline to full by 12-20 device px,
 * on two islands, and the Waves-OFF profile is flat so the rim is ours rather than the basemap's.
 * What that CANNOT say is whether the renderer is fading a constant field or faithfully drawing a
 * field that really does fall off near shore. Those demand opposite fixes — one is an alpha bug,
 * the other means the rim is honest and the colour ramp's low end is the only thing to look at.
 *
 * THE DISCRIMINATOR: read the underlying grid VALUES along the same radial rays and compare their
 * profile to the colour profile, point for point.
 *   values flat  + colour ramps  ⇒ RENDERER
 *   values fall  + colour follows ⇒ DATA, and the halo is truthful
 *
 * Values come off the WIRE (`/api/weather/grid` → `grid.vectors[].speed` over `grid.bounds`), not
 * from `window.__MARINE_ENGINE__` — that handle is absent on the deployed build, so an in-page read
 * would silently return null and look like "no data" (measured 2026-08-16).
 *
 * ⭐ A SECOND, CHEAPER TEST FALLS OUT FOR FREE: the grid's CELL SIZE in device px. If one cell is
 * far wider than the 12-20 px ramp, the data cannot express a shore-aligned gradient at that scale
 * at all, whatever its values are — the ramp would have to be the renderer by construction. That
 * check needs no interpolation and no assumption about the sampling.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.HV_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'halo-value-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[value-vs-colour] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGETS = [
  { id: 'grand_bahama', center: [-78.66, 26.62], z: 8.85, rayDeg: 0.30 },
  { id: 'nassau', center: [-77.35, 25.05], z: 10.17, rayDeg: 0.30 },
];
const DISTS = [1, 2, 3, 5, 8, 12, 20, 35];

/** Nearest-cell sample of `speed` from a served grid, in the grid's own row order (row 0 = north). */
function sampleGrid(grid, lng, lat) {
  if (!grid || !grid.bounds || !Array.isArray(grid.vectors)) return null;
  const b = grid.bounds, cols = grid.cols, rows = grid.rows;
  if (!cols || !rows) return null;
  const fx = (lng - b.west) / (b.east - b.west);
  const fy = (b.north - lat) / (b.north - b.south);
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const cx = Math.min(cols - 1, Math.max(0, Math.round(fx * (cols - 1))));
  const cy = Math.min(rows - 1, Math.max(0, Math.round(fy * (rows - 1))));
  const v = grid.vectors[cy * cols + cx];
  return v ? (typeof v.speed === 'number' ? v.speed : null) : null;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });

  // keep every served grid; the one covering the target with the FINEST cells is the one on screen
  const grids = [];
  page.on('response', async (res) => {
    if (!/\/api\/weather\/grid/.test(res.url())) return;
    try {
      const j = await res.json();
      const g = j && j.grid;
      if (g && Array.isArray(g.vectors) && g.bounds && g.cols && g.rows) {
        grids.push({ bounds: g.bounds, cols: g.cols, rows: g.rows, vectors: g.vectors,
          rated: !!(g.diagnostics && g.diagnostics.surf_transform && g.diagnostics.surf_transform.value_kind === 'surf_rating') });
      }
    } catch (e) {}
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
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });

  const out = [];
  for (const tgt of TARGETS) {
    await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: tgt.center, z: tgt.z });
    await page.waitForTimeout(13000);

    const geo = await page.evaluate(async ({ tgt, dists }) => {
      const m = window.map;
      await new Promise((r) => { const fn = () => { m.off('render', fn); r(); }; m.on('render', fn); m.triggerRepaint(); });
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect(), dpr = src.width / rect.width;
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
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const rays = [];
      for (let b = 0; b < 24; b++) {
        const th = (b / 24) * 2 * Math.PI;
        const dest = [tgt.center[0] + tgt.rayDeg * Math.sin(th) / Math.cos(tgt.center[1] * Math.PI / 180),
          tgt.center[1] + tgt.rayDeg * Math.cos(th)];
        const p0 = m.project(tgt.center), p1 = m.project(dest);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
        const water = [];
        for (let i = 0; i <= n; i++) {
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const okv = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
            && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
          let w = null;
          if (okv) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
          water.push(w);
        }
        let coast = -1;
        for (let i = 1; i + 8 <= n; i++) {
          if (water[i] !== true) continue;
          let ok = true; for (let k = 0; k < 8; k++) if (water[i + k] !== true) { ok = false; break; }
          if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
        }
        if (coast < 0) continue;
        const pts = [];
        for (const d of dists) {
          const i = coast + d; if (i > n) { pts.push(null); continue; }
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const ll = m.unproject([cx, cy]);
          pts.push({ d, lng: ll.lng, lat: ll.lat, rgb: px(cx, cy) });
        }
        rays.push({ b, pts });
      }
      // grid cell size in DEVICE px, for the by-construction test
      const cellPx = (cols, west, east) => {
        const a = m.project([west, tgt.center[1]]), c = m.project([east, tgt.center[1]]);
        return Math.abs(c.x - a.x) * dpr / Math.max(1, cols - 1);
      };
      return { z: +m.getZoom().toFixed(2), rays, dpr, _cellPxFn: null,
        project: { west: m.getBounds().getWest(), east: m.getBounds().getEast() },
        cellPxProbe: (() => {
          const a = m.project([tgt.center[0], tgt.center[1]]), c = m.project([tgt.center[0] + 1, tgt.center[1]]);
          return Math.abs(c.x - a.x) * dpr;      // device px per DEGREE of longitude
        })() };
    }, { tgt, dists: DISTS });

    // pick the finest served grid that contains this target
    const covering = grids.filter((g) => tgt.center[0] >= g.bounds.west && tgt.center[0] <= g.bounds.east
      && tgt.center[1] >= g.bounds.south && tgt.center[1] <= g.bounds.north);
    covering.sort((a, b) => ((a.bounds.east - a.bounds.west) / a.cols) - ((b.bounds.east - b.bounds.west) / b.cols));
    const grid = covering[0] || null;
    if (!grid) { log(`${tgt.id}: NO COVERING GRID CAPTURED — refusing`); out.push({ target: tgt.id, void: 'NO_GRID' }); continue; }

    const cellDeg = (grid.bounds.east - grid.bounds.west) / Math.max(1, grid.cols - 1);
    const cellDevPx = cellDeg * geo.cellPxProbe;

    // per distance bucket: mean colour and mean grid value, over all rays
    const agg = {};
    for (const d of DISTS) agg[d] = { rgb: [], val: [] };
    for (const ray of geo.rays) {
      for (const p of ray.pts) {
        if (!p) continue;
        if (p.rgb) agg[p.d].rgb.push(p.rgb);
        const v = sampleGrid(grid, p.lng, p.lat);
        if (typeof v === 'number') agg[p.d].val.push(v);
      }
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const rows = DISTS.map((d) => ({
      d,
      lum: agg[d].rgb.length ? +mean(agg[d].rgb.map((c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])).toFixed(1) : null,
      value: agg[d].val.length ? +mean(agg[d].val).toFixed(3) : null,
      n: agg[d].val.length,
    }));
    const v1 = rows[0].value, vFar = rows[rows.length - 1].value;
    const valueSpread = (v1 !== null && vFar !== null && vFar !== 0) ? +(v1 / vFar).toFixed(3) : null;

    out.push({ target: tgt.id, z: geo.z, rays: geo.rays.length, gridCols: grid.cols, gridRows: grid.rows,
      rated: grid.rated, cellDeg: +cellDeg.toFixed(4), cellDevPx: +cellDevPx.toFixed(1), rows, valueSpread });
    log(`${tgt.id} z${geo.z} rays=${geo.rays.length} grid=${grid.cols}x${grid.rows} rated=${grid.rated} `
      + `CELL=${cellDevPx.toFixed(0)} device px (${cellDeg.toFixed(3)}°)`);
    log('   d:      ' + rows.map((r) => String(r.d).padStart(7)).join(''));
    log('   lum:    ' + rows.map((r) => String(r.lum === null ? '-' : r.lum).padStart(7)).join(''));
    log('   value:  ' + rows.map((r) => String(r.value === null ? '-' : r.value).padStart(7)).join(''));
    log(`   value(d1)/value(d35) = ${valueSpread}`);
  }

  fs.writeFileSync(path.join(outdir, 'halo-value-vs-colour.json'), JSON.stringify({ base: BASE, out }, null, 1));
  log('written: ' + path.join(outdir, 'halo-value-vs-colour.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

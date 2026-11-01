// Records the exact inputs of every basemap-water mask paint the app performs on a zoom/pan flow (offline only,
// 2026-10-20), so a bench can replay them outside the app: the paint kind (regional base / viewport overlay), the canvas
// bounds, the map bounds the painter reads, the style's water layers, and every feature MapLibre returned to the painter
// (queryRenderedFeatures for water, querySourceFeatures for water fallback and wetlands). Measurement-only: the engine's
// two refresh methods and the map's query methods are wrapped in the page to OBSERVE; arguments and results pass through.
//   PORT=4140 AB_BASE=http://127.0.0.1:3140 THEME=dark OUT=capture-dark.json node scripts/offline-backend/scn_mask_capture.js
const fs = require('fs');
const L = require('./ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4140);
const THEME = process.env.THEME || 'dark';
const WAIT_MS = +(process.env.WAIT_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEPS = [[-80, 26, 6], [-80, 26, 8], [-77, 26, 8], [-80, 27, 8], [-76, 28, 8], [-80.1, 26.6, 9.5]];

(async () => {
  const { browser, page } = await L.launch({ port: PORT });
  await page.addInitScript((theme) => { localStorage.setItem('raw-surf-theme', theme); }, THEME);
  await page.addInitScript(() => {
    const C = (window.__MASKCAP__ = { paints: [], active: [] });
    const ser = (f) => ({ properties: { class: f.properties && f.properties.class, subclass: f.properties && f.properties.subclass },
      geometry: f.geometry ? { type: f.geometry.type, coordinates: f.geometry.coordinates } : null });
    const wrapMap = (m) => {
      if (m.__maskCapWrapped) return; m.__maskCapWrapped = true;
      const qr = m.queryRenderedFeatures.bind(m), qs = m.querySourceFeatures.bind(m), gb = m.getBounds.bind(m);
      m.queryRenderedFeatures = function (...a) { const r = qr(...a); const top = C.active[C.active.length - 1]; if (top) top.rendered.push({ args: JSON.parse(JSON.stringify(a[0] || null)), feats: (r || []).map(ser) }); return r; };
      m.querySourceFeatures = function (src, opt) { const r = qs(src, opt); const top = C.active[C.active.length - 1]; if (top) top.source.push({ src, sourceLayer: opt && opt.sourceLayer, feats: (r || []).map(ser) }); return r; };
      m.getBounds = function () { const b = gb(); const top = C.active[C.active.length - 1]; if (top && !top.mapBounds) top.mapBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }; return b; };
    };
    const hook = () => {
      const e = window.__MARINE_ENGINE__; const m = window.__MAP_INSTANCE__ || window.map;
      if (!e || !m) return; wrapMap(m);
      if (e.__maskCapWrapped) return; e.__maskCapWrapped = true;
      for (const [method, kind] of [['refreshMaskWithBasemapWater', 'regional'], ['refreshViewportOverlayMask', 'overlay']]) {
        const orig = e[method];
        e[method] = function (gl, map, basin) {
          const rec = { kind, t: Math.round(performance.now()), zoom: map.getZoom(), rendered: [], source: [], mapBounds: null, basin: !!basin };
          const before = kind === 'overlay' ? e._overlayMaskBounds : e._cachedMaskTex;
          C.active.push(rec);
          let r; try { r = orig.call(this, gl, map, basin); } finally { C.active.pop(); }
          rec.result = r;
          rec.reason = e._lastMaskRepatchReason || null;
          if (kind === 'overlay') rec.bounds = e._overlayMaskBounds !== before ? e._overlayMaskBounds : null;
          else rec.bounds = r ? { ...e._cachedMaskBounds } : null;
          rec.geo = e._cachedMaskGeoJSON === window.__LAND_GEOJSON_HIRES_CACHE__ ? '10m' : (e._cachedMaskGeoJSON && e._cachedMaskGeoJSON.features ? `other:${e._cachedMaskGeoJSON.features.length}` : 'none');
          rec.style = ((map.getStyle() || {}).layers || []).filter((l) => l.id === 'water' || (l.type === 'fill' && /water/.test(l['source-layer'] || ''))).map((l) => ({ id: l.id, type: l.type, source: l.source, 'source-layer': l['source-layer'] }));
          if (r && (rec.rendered.length || rec.source.length)) C.paints.push(rec);
          return r;
        };
      }
    };
    setInterval(hook, 200);
  });
  try {
    await L.openMap(page); await L.jump(page, -80, 25, 3.5);
    const loc = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
    await sleep(10000);
    for (const [lng, lat, z] of STEPS) { await L.jump(page, lng, lat, z); await sleep(WAIT_MS); }
    const cap = await page.evaluate(() => ({ theme: localStorage.getItem('raw-surf-theme'), has10m: !!window.__LAND_GEOJSON_HIRES_CACHE__, paints: window.__MASKCAP__.paints }));
    console.log(`theme ${cap.theme} paints ${cap.paints.length} (${cap.paints.map((p) => p.kind[0] + (p.bounds ? '' : '?')).join('')}) 10m=${cap.has10m}`);
    fs.writeFileSync(process.env.OUT || `mask-capture-${THEME}.json`, JSON.stringify(cap));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });

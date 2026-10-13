/**
 * fallback-paints.js — when the marine layer falls back, does ANYTHING actually paint?
 *
 * THE QUESTION. The guardrail swaps the WebGL marine field for Open-Meteo raster tiles. The new
 * legend notice says "Simplified wave layer", which asserts a simplified layer EXISTS. That was
 * never verified — the disclosure was checked for text, contrast and live-region count, not for the
 * truth of its own claim. If nothing paints, the notice is wrong AND the fallback does not fall
 * back, which is worse than the defect it was written for.
 *
 * SUSPICION, and why it is specific rather than general: the fallback URL is
 * `om://https://map-tiles.open-meteo.com/...` (useOpenMeteoTileUrls.js:442), an `om://` protocol
 * whose decoder is `@openmeteo/file-format-wasm` — and the local dev server reports COMPILE ERRORS
 * in exactly that package. A broken decoder paints nothing while every other signal looks healthy.
 *
 * THREE LEGS, because two cannot answer it. Each is its own page load: the fallback is read from
 * localStorage by a useState initialiser at mount, so it cannot be toggled in place.
 *
 *   A  waves OFF                  — the TRUE NEGATIVE. Bare basemap water; whatever this looks
 *                                   like is what "nothing painted" looks like.
 *   B  waves ON + fallback FORCED — the state under test.
 *   C  waves ON + WebGL           — the POSITIVE CONTROL. Proves the sampler can see a painted
 *                                   ocean at all; without it, B≈A is unreadable (it could just
 *                                   mean the sampler is broken).
 *
 * VERDICT: B≈A ⇒ the fallback paints NOTHING. B≠A ⇒ it paints something.
 *
 * TWO INDEPENDENT DISCRIMINATORS, so the answer does not rest on one comparison:
 *   1. BETWEEN legs — ocean colour distance from leg A.
 *   2. WITHIN a leg — spatial variance across the ocean. Bare basemap water is flat; a wave-height
 *      raster has structure. This one needs no baseline at all.
 *
 * Plus network (do the tile requests fire, and what do they return) and console (does the decoder
 * throw). Sampling only accepts points that are basemap WATER and whose topmost element is the map
 * canvas — a pixel under the weather panel is not evidence about the ocean.
 *
 *   FP_BASE=http://localhost:3000 node scripts/fallback-paints.js <outdir>
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.FP_BASE || 'http://localhost:3000';
const LABEL = process.env.FP_LABEL || BASE;
const outdir = process.argv[2] || path.join(__dirname, 'fallback-paints-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[fallback-paints] ' + m);

const CENTER = [-78.0, 27.0];
const ZOOM = 6.5;
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };

const LEGS = [
  { id: 'A_waves_off', waves: false, forceFallback: false },
  { id: 'B_fallback_forced', waves: true, forceFallback: true },
  { id: 'C_webgl_control', waves: true, forceFallback: false },
];

async function runLeg(browser, leg) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const net = [];
  const errs = [];
  const wasm = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (/open-meteo|map-tiles/i.test(u)) net.push({ status: res.status(), url: u.slice(0, 170) });
    // The decoder's own binary. A dev server that answers this with the SPA's index.html is the
    // whole local failure, and it is invisible unless the MIME type and the magic word are read:
    // a wasm module starts `00 61 73 6d`, HTML starts `3c 21 64 6f` ("<!do").
    if (/\.wasm(\?|$)/i.test(u)) {
      const rec = { status: res.status(), ct: res.headers()['content-type'] || null, url: u.slice(0, 140) };
      try { const b = await res.body(); rec.magic = [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join(' '); }
      catch (e) { rec.magic = 'unreadable'; }
      rec.isWasm = rec.magic === '00 61 73 6d';
      wasm.push(rec);
    }
  });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /wasm|om:\/\/|decode|Fallback|tile/i.test(t)) errs.push(t.slice(0, 220));
  });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 220)));

  // The fallback flag is read by a useState initialiser at mount, so it must be present BEFORE the
  // app boots — hence addInitScript rather than a post-load localStorage write.
  await page.addInitScript(({ force }) => {
    try {
      if (force) localStorage.setItem('force_marine_fallback', 'true');
      else localStorage.removeItem('force_marine_fallback');
      // Leg C must not have the guardrail trip mid-run on a deployed host (SwiftShader is ~1 FPS).
      window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    } catch (e) {}
  }, { force: leg.forceFallback });

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
    localStorage.setItem('__SURF_MODE__', 'true');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();     // dev-server error overlay
    }
  });

  if (leg.waves) {
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .some((b) => (b.textContent || '').trim() === 'Waves'), null, { timeout: 60000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    });
  }
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: CENTER, z: ZOOM });
  await page.waitForTimeout(22000);        // generous: tiles + decode + commit
  await page.evaluate(() => window.map.triggerRepaint());
  await page.waitForTimeout(2500);

  const s = await page.evaluate(async () => {
    const m = window.map;
    await new Promise((r) => { const fn = () => { m.off('render', fn); r(); }; m.on('render', fn); m.triggerRepaint(); });
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

    const pts = [];
    for (let x = 200; x <= 780; x += 30) {
      for (let y = 150; y <= 700; y += 30) {
        // a pixel under a UI panel says nothing about the ocean
        const top = document.elementFromPoint(x, y);
        if (!top || top.tagName !== 'CANVAS') continue;
        let isWater = false;
        try { isWater = m.queryRenderedFeatures([x, y], { layers: waterIds }).length > 0; } catch (e) {}
        if (!isWater) continue;
        const px = Math.round(x * dpr), py = Math.round(y * dpr);
        const o = (py * cv.width + px) * 4;
        pts.push([img[o], img[o + 1], img[o + 2]]);
      }
    }
    const n = pts.length;
    const mean = n ? [0, 1, 2].map((k) => pts.reduce((a, p) => a + p[k], 0) / n) : null;
    const lum = pts.map((p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]);
    const lm = n ? lum.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n ? Math.sqrt(lum.reduce((a, b) => a + (b - lm) ** 2, 0) / n) : 0;
    const uniq = new Set(pts.map((p) => p.join(','))).size;

    // Structural: is a marine raster layer even in the style, and does its source have a URL?
    const order = (m.style && m.style._order) ? m.style._order : (m.getStyle().layers || []).map((l) => l.id);
    const slotLayers = order.filter((id) => /slot-\d+-layer/.test(id)).map((id) => {
      let vis = null, opacity = null, srcUrl = null;
      try { vis = m.getLayoutProperty(id, 'visibility'); } catch (e) {}
      try { opacity = m.getPaintProperty(id, 'raster-opacity'); } catch (e) {}
      try {
        const l = m.getLayer(id); const s = l && m.getSource(l.source);
        srcUrl = s ? (s.url || (s.tiles && s.tiles[0]) || null) : null;
      } catch (e) {}
      return { id, vis, opacity, srcUrl: srcUrl ? String(srcUrl).slice(0, 120) : null };
    });

    return {
      z: +m.getZoom().toFixed(2), samples: n, meanRGB: mean ? mean.map((v) => Math.round(v)) : null,
      lumMean: +lm.toFixed(2), lumSD: +sd.toFixed(2), uniqueColours: uniq,
      marineFailed: !!(window.__WEBGL_GUARDRAIL_FALLBACK__ && window.__WEBGL_GUARDRAIL_FALLBACK__.webglMarineFailed),
      ratingBand: (window.__RAW_GPU__ && window.__RAW_GPU__.ratingBand) || null,
      slotLayers,
    };
  });

  await page.screenshot({ path: path.join(outdir, `FP_${leg.id}.png`) });
  await ctx.close();
  return { leg: leg.id, ...s, net, wasm, errs: [...new Set(errs)].slice(0, 12) };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const results = [];
  for (const leg of LEGS) {
    const r = await runLeg(browser, leg);
    results.push(r);
    log(`${leg.id}: n=${r.samples} meanRGB=${JSON.stringify(r.meanRGB)} lumSD=${r.lumSD} uniq=${r.uniqueColours} `
      + `marineFailed=${r.marineFailed} slots=${r.slotLayers.length} omReqs=${r.net.length} wasm=${JSON.stringify(r.wasm.map((w) => w.status + (w.isWasm ? ":OK" : ":" + w.magic)))}`);
    if (r.errs.length) log('   err: ' + r.errs[0]);
  }
  const A = results.find((r) => r.leg === 'A_waves_off');
  const d = (x) => (x.meanRGB && A.meanRGB)
    ? Math.max(...[0, 1, 2].map((k) => Math.abs(x.meanRGB[k] - A.meanRGB[k]))) : null;
  log('');
  log(`distance from A (waves off):  B=${d(results.find((r) => r.leg === 'B_fallback_forced'))}  `
    + `C=${d(results.find((r) => r.leg === 'C_webgl_control'))}`);
  fs.writeFileSync(path.join(outdir, 'fallback-paints.json'),
    JSON.stringify({ base: BASE, label: LABEL, center: CENTER, zoom: ZOOM, results }, null, 1));
  log('written: ' + path.join(outdir, 'fallback-paints.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * ratingmode-rootcause.js — root-cause "the rating band is under the heatmap" along the whole chain.
 *
 * THE CHAIN, and where it can break (each link is observed, none is assumed):
 *   L1 REQUEST   the grid fetch carries `&surf=1`            (backendWeatherServiceClient.js:506,
 *                                                             marineGridSeries.js:406)
 *   L2 RESPONSE  the backend ran the transform — the tag is nested at
 *                `grid.diagnostics.surf_transform.value_kind === 'surf_rating'`.
 *                ⚠️ reading `diagnostics.value_kind` instead falls back to the product's TOP-LEVEL
 *                value_kind, which stays `wave_height` even when the overlay ran (QUEUE E#1
 *                instrument landmine — it once made every row read "not rated").
 *   L3 STAMP     the client sets `ratingMode` from that tag (…Helpers.js:305) and series frames set
 *                it from `frame.rating_mode` (marineGridSeries.js:290 — the `_frame_rating_mode`
 *                regression: without it the band never rendered even with surf=1)
 *   L4 COMMIT    the arbiter accepts it; flavor must match (marineCommitArbiter.js:181)
 *   L5 PAINT     `__RAW_GPU__.ratingBand.active` — and `forcedOff` names L1-L4 failing as a group
 *
 * ⛔ FRESH-READ ASSERTION — the reason this harness exists in this form.
 * `__RAW_GPU__` FREEZES when the engine's render returns early (measured: `.ratingBandFade.span`
 * held 0.742 across twelve cameras from a 0.74° viewport to a 47° one, and survived a real 34-notch
 * wheel descent). A stale read is indistinguishable from a measurement unless freshness is proven,
 * so every stop here is gated on TWO independent liveness signals and REFUSES if either fails:
 *   F1 a NEW `[rating-band]` console breadcrumb (the engine emits one per render, throttled ~2 s)
 *      arrives after the camera settles — proof the render path ran for THIS camera;
 *   F2 `__RAW_GPU__.ratingBandFade.span` agrees with the live viewport span.
 * A stop failing either is reported REFUSED, never as a zero.
 *
 * Real wheel notches, not jumpTo — and video, so the transition is watchable rather than inferred.
 *
 *   node scripts/ratingmode-rootcause.js <outdir>
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RM_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'ratingmode-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[rootcause] ' + m);

// Coast IN VIEW and centred — the earlier ladder sat on open ocean at close zoom, where no band is
// expected and a "no band" reading means nothing.
const CENTER = [-80.00, 26.60];
// shore -> 40 km offshore. The band is a ~10 MILE (16 km) coastal RIBBON that tapers into the wash,
// so its signature is a colour STEP near 16 km, not a palette. Palette-independent on purpose.
const TRANSECT = { from: [-80.07, 26.60], to: [-79.67, 26.60] };
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const findWaves = () => Array.from(document.querySelectorAll('button'))
  .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves') || null;
const findRating = () => Array.from(document.querySelectorAll('button'))
  .find((x) => /Surf Rating:/.test(x.textContent || '')) || null;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    recordVideo: { dir: outdir, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  // ── THE PAIRED LEG. useWebGLGuardrail drops the WebGL marine layer to the Canvas2D fallback after
  // 12 consecutive seconds under 20 FPS. Under SwiftShader this fires for HARNESS reasons (~1 FPS),
  // so the default leg cannot distinguish "the band is broken" from "the band's renderer was
  // switched off underneath it". Disabling the guardrail is the control that separates them.
  // NB the guardrail also self-exempts on localhost — so it can only ever fire on a deployed host.
  if (process.env.RM_NO_GUARDRAIL === '1') {
    await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
    log('CONTROL LEG: __DISABLE_WEBGL_GUARDRAIL__ = true');
  }

  // ── L5/liveness: console breadcrumbs, timestamped by US (the page's own throttle is ~2 s) ──
  const console_ = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/\[rating-band\]|\[BUILD\]|FORENSIC-SNAP|grid_commit|no-downgrade|returned early|Fallback/i.test(t)) {
      console_.push({ at: Date.now(), text: t.slice(0, 300) });
    }
  });

  // ── L1/L2: every grid fetch and what came back. Only diagnostics are kept, never the grid. ──
  const net = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\/weather\/grid/.test(url)) return;
    const rec = { at: Date.now(), url: url.slice(0, 320), status: res.status(),
      surfParam: /[?&]surf=1/.test(url), bbox: (url.match(/bbox=([^&]+)/) || [])[1] || null };
    try {
      const j = await res.json();
      const g = j && j.grid;
      const d = g && g.diagnostics;
      // L2 read at the NESTED tag — reading d.value_kind here would be the E#1 landmine
      rec.surf_transform = d ? (d.surf_transform || null) : null;
      rec.nested_value_kind = rec.surf_transform ? (rec.surf_transform.value_kind || null) : null;
      rec.toplevel_value_kind = d ? (d.value_kind || null) : null;
      rec.mid_res_tier = d ? !!d.mid_res_tier : null;
      rec.cols = g ? g.cols : null;
      rec.frames = Array.isArray(j.frames) ? j.frames.length : null;
      rec.frame_rating_modes = Array.isArray(j.frames)
        ? [...new Set(j.frames.map((f) => !!f.rating_mode))] : null;
      rec.grid_rating_mode = g ? (g.rating_mode ?? null) : null;
    } catch (e) { rec.bodyError = String(e.message).slice(0, 80); }
    net.push(rec);
  });

  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  const build = await page.evaluate(async () => {
    try { const r = await fetch('/service-worker.js', { cache: 'no-store' }); const t = await r.text();
      const m = t.match(/BUILD_VERSION\s*=\s*'([^']+)'/); return m ? m[1] : '?'; } catch (e) { return '?'; }
  });
  log('build=' + build);

  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 60000 });
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(`(() => { const b = (${findRating.toString()})(); if (b && /OFF/.test(b.textContent)) b.click(); })()`);
  await page.waitForTimeout(12000);
  const chip = await page.evaluate(`(() => { const b = (${findRating.toString()})(); return b ? b.textContent.trim() : null; })()`);
  log('rating chip: ' + chip);
  const surfFlag = await page.evaluate(() => ({
    winFlag: window.__SURF_MODE__, lsFlag: localStorage.getItem('__SURF_MODE__'),
    forensic: typeof window.__RAW_FORENSIC__,
  }));
  log('surf flag: ' + JSON.stringify(surfFlag));

  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) f.remove();
    }
  });
  await page.evaluate(({ c }) => window.map.jumpTo({ center: c, zoom: 11 }), { c: CENTER });
  await page.waitForTimeout(12000);
  await page.mouse.move(640, 400);

  const capture = async (tag) => {
    const t0 = Date.now();
    await page.evaluate(() => { try { window.__RAW_FORENSIC__ && window.__RAW_FORENSIC__.reset(); } catch (e) {} });
    const netMark = net.length;
    await page.waitForTimeout(9000);                 // let the engine settle AND emit a breadcrumb
    await page.evaluate(() => window.map.triggerRepaint());
    await page.waitForTimeout(2500);

    const s = await page.evaluate(async ({ t }) => {
      const m = window.map, g = window.__RAW_GPU__ || {};
      await new Promise((r) => { const fn = () => { m.off('render', fn); r(); }; m.on('render', fn); m.triggerRepaint(); });
      const b = m.getBounds();
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const p0 = m.project(t.from), p1 = m.project(t.to);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(2, Math.round(Math.hypot(dx, dy) * dpr));
      const rgb = [];
      for (let i = 0; i <= n; i++) {
        const px = Math.round((p0.x + dx * i / n) * dpr), py = Math.round((p0.y + dy * i / n) * dpr);
        if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) { rgb.push(null); continue; }
        const o = (py * cv.width + px) * 4;
        rgb.push([img[o], img[o + 1], img[o + 2]]);
      }
      const f = g.ratingBandFade || {};
      return {
        z: +m.getZoom().toFixed(2), liveSpan: +(b.getEast() - b.getWest()).toFixed(3),
        telemetrySpan: (typeof f.span === 'number') ? +f.span.toFixed(3) : null,
        ratingBand: g.ratingBand || null,        // flag / gridRatingMode / forcedOff / active / fromSeries
        fade: { bandMult: f.bandMult, spanFade: f.spanFade, wash: f.washStrength },
        overlay: g.overlayMask ? g.overlayMask.reason : null,
        forensic: (() => { try { return window.__RAW_FORENSIC__.summary(); } catch (e) { return null; } })(),
        n, rgb,
      };
    }, { t: TRANSECT });

    // ── F1: did a NEW breadcrumb arrive after this stop began? ──
    const fresh = console_.filter((c) => c.at > t0 && /\[rating-band\]/.test(c.text));
    // ── F2: does the telemetry's own span agree with the live viewport? ──
    const spanAgrees = s.telemetrySpan !== null && Math.abs(s.telemetrySpan - s.liveSpan) <= 0.05;
    const verdict = (fresh.length > 0 && spanAgrees) ? 'FRESH'
      : (fresh.length === 0 && !spanAgrees) ? 'REFUSED_STALE_BOTH'
        : (fresh.length === 0 ? 'REFUSED_NO_BREADCRUMB' : 'REFUSED_SPAN_MISMATCH');

    await page.screenshot({ path: path.join(outdir, `RC_${tag}.png`) });
    const rb = s.ratingBand || {};
    log(`${tag}: z=${s.z} span=${s.liveSpan} [${verdict}] breadcrumbs=${fresh.length} ` +
      `| flag=${rb.flag} gridRating=${rb.gridRatingMode} forcedOff=${rb.forcedOff} active=${rb.active} ` +
      `cols=${rb.gridCols} fromSeries=${rb.fromSeries} | net+${net.length - netMark}`);
    if (fresh.length) log('   breadcrumb: ' + fresh[fresh.length - 1].text.slice(0, 190));
    return { tag, verdict, freshBreadcrumbs: fresh.length, spanAgrees, ...s, netSince: net.slice(netMark) };
  };

  const stops = [];
  stops.push(await capture('z11_coast'));
  for (const [tag, notches] of [['z10_coast', 4], ['z9_coast', 4], ['z8_coast', 4], ['z7_coast', 4], ['z6_coast', 4]]) {
    for (let i = 0; i < notches; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(220); }
    stops.push(await capture(tag));
  }

  fs.writeFileSync(path.join(outdir, 'rootcause-raw.json'), JSON.stringify({
    generated_at: new Date().toISOString(), base: BASE, build, chip, surfFlag,
    center: CENTER, transect: TRANSECT, stops, net, console: console_,
  }));
  log('written: ' + path.join(outdir, 'rootcause-raw.json'));
  await ctx.close();      // flushes the video
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

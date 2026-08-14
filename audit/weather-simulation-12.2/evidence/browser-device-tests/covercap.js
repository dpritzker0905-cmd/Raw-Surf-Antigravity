/**
 * covercap.js — Audit 12.2 coverage probe.
 *
 * ANSWERS ONE QUESTION EMPIRICALLY, PER (BROWSER x DEVICE x MODEL x LAYER):
 *   "when the user activates this layer, do the pixels change?"
 *
 * Method: differential pixel oracle. Screenshot with the layer OFF, screenshot with it ON,
 * diff via frontend/e2e/pngPixels.js (the repo's own dependency-free decoder). A layer that
 * paints moves pixels; a layer that silently no-ops does not. This is deliberately a PIXEL
 * question because `queryRenderedFeatures` never returns raster layers, so a protocol/source
 * census cannot answer "did it paint".
 *
 * READ-ONLY. Navigates the dev deployment, seeds a mock user into localStorage exactly as
 * frontend/e2e/weather-simulation.spec.js and audit 12.1's zoomcap.js already do (no
 * credentials, no account creation, no form submission, no writes).
 *
 *   node covercap.js <chromium|firefox> <desktop|mobile> [outSuffix]
 */
const path = require('path');
const fs = require('fs');
const PW = 'C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core';
const { chromium, firefox } = require(PW);
const { diffFraction, varianceFraction } = require('C:/Users/dprit/Raw-Surf/frontend/e2e/pngPixels.js');

const BROWSER = process.argv[2] || 'chromium';
const DEVICE = process.argv[3] || 'desktop';
const SUFFIX = process.argv[4] || `${BROWSER}-${DEVICE}`;
const BASE = process.env.CAP_BASE || 'https://dev--rawsurf.netlify.app';
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-12.2/evidence/browser-device-tests';
const SHOTS = path.join(OUT, `shots-${SUFFIX}`);

const LAYERS = [
  'Wind', 'Waves', 'Swell', 'Swell 2', 'Wind Waves', 'Precip',
  'Radar', 'Satellite', 'Fog', 'Pressure', 'Air Temp', 'Water Temp',
];
const MODELS = ['GFS', 'EURO'];

const user = {
  id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const engine = BROWSER === 'firefox' ? firefox : chromium;
  const browser = await engine.launch({ headless: true });

  const viewport = DEVICE === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const ctxOpts = {
    viewport,
    deviceScaleFactor: DEVICE === 'mobile' ? 2 : 1,   // 3 made each screenshot exceed 30 s
    hasTouch: DEVICE === 'mobile',
    isMobile: DEVICE === 'mobile' && BROWSER === 'chromium',   // firefox rejects isMobile
    recordVideo: { dir: SHOTS, size: viewport },
  };
  if (BROWSER === 'firefox') { delete ctxOpts.isMobile; delete ctxOpts.deviceScaleFactor; }
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  // 2026-08-13: the first pass died twice on Playwright's 30 s defaults — Firefox needed 46.6 s to
  // reach domcontentloaded on /auth, and a DPR-3 mobile screenshot (1170x2532) exceeded 30 s.
  // Both were HARNESS limits, not product defects (Firefox positive control: /auth -> HTTP 200).
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(120000);

  const consoleErrors = [];
  const pageErrors = [];
  const netFail = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      consoleErrors.push({ type: m.type(), text: m.text().slice(0, 300) });
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  // ⛔ REDACT BEFORE STORING, NOT AFTER. The first run of this harness captured the live
  // `access_token=pk.eyJ…` Mapbox token 21 times across two configs, because a tile URL carries it
  // as a query parameter — and it did so into a file this audit then proposed to commit, while the
  // audit's own security section claimed no token appeared in any 12.2 artifact. Caught by a
  // pre-commit scan; the claim was false until it was fixed.
  // ★ The general rule this is an instance of: a RETAINED ARTIFACT IS A DISCLOSURE SURFACE, and
  //   "we did not put a secret in it" is a hope unless something strips them on the way in.
  const redact = (u) => String(u)
    .replace(/(access_token=)(pk\.[A-Za-z0-9_.-]+)/g, '$1<REDACTED-MAPBOX-PUBLIC-TOKEN>')
    .replace(/(access_token=)(sk\.[A-Za-z0-9_.-]+)/g, '$1<REDACTED-SECRET>')
    .replace(/\b(apikey|api_key|token|key)=([A-Za-z0-9_-]{20,})/gi, '$1=<REDACTED>');
  page.on('requestfailed', (r) => netFail.push({ url: redact(r.url()).slice(0, 200), err: String(r.failure() && r.failure().errorText) }));

  const result = {
    browser: BROWSER, device: DEVICE, viewport, base: BASE,
    startedAt: new Date().toISOString(),
    boot: {}, capabilities: {}, models: {}, a11y: {}, consoleErrors: [], pageErrors: [], netFail: [],
  };

  // ── boot ─────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
  }, { u: user });

  const t0 = Date.now();
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(DEVICE === 'mobile' ? 20000 : 16000);
  result.boot.domToSettleMs = Date.now() - t0;

  // WebGL / capability census — the same reading, taken in each browser
  result.capabilities = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { webgl: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl: true,
      version: gl.getParameter(gl.VERSION),
      webgl2: !!c.getContext('webgl2'),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'masked',
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      dpr: window.devicePixelRatio,
      webgpu: typeof navigator.gpu !== 'undefined',
      ua: navigator.userAgent.slice(0, 120),
      touchPoints: navigator.maxTouchPoints,
    };
  });

  // map handle
  await page.evaluate(() => {
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function') { window.__M__ = v; return; }
      } catch (e) { /* cross-origin getter */ }
    }
  });
  result.boot.mapFound = await page.evaluate(() => !!window.__M__);

  // If the map never mounted, say so loudly and stop — a layer census against no map is not a
  // measurement of the layers.
  if (!result.boot.mapFound) {
    result.boot.refused = 'MAP HANDLE NEVER APPEARED — no layer claims made';
    result.consoleErrors = consoleErrors.slice(0, 80);
    result.pageErrors = pageErrors.slice(0, 40);
    result.netFail = netFail.slice(0, 40);
    await page.screenshot({ path: path.join(SHOTS, 'BOOT-FAILED.png') }).catch(() => {});
    fs.writeFileSync(path.join(OUT, `coverage-${SUFFIX}.json`), JSON.stringify(result, null, 1));
    await ctx.close(); await browser.close();
    console.log('REFUSED: map handle never appeared'); return;
  }

  // ── a11y census on the weather controls (mandate check, all three layouts) ────
  result.a11y = await page.evaluate((labels) => {
    const btns = [...document.querySelectorAll('button')];
    const layerBtns = btns.filter((b) => labels.includes((b.textContent || '').trim()));
    const divClickable = [...document.querySelectorAll('div[onclick], [role="button"]:not(button)')].length;
    return {
      totalButtons: btns.length,
      layerButtonsFound: layerBtns.map((b) => (b.textContent || '').trim()),
      layerButtonsWithAriaPressed: layerBtns.filter((b) => b.hasAttribute('aria-pressed')).length,
      layerButtonsWithAriaLabel: layerBtns.filter((b) => b.hasAttribute('aria-label')).length,
      iconOnlyButtonsNoLabel: btns.filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length,
      nonButtonRoleButtons: divClickable,
      minTouchTargetPx: layerBtns.length
        ? Math.min(...layerBtns.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }))
        : null,
    };
  }, LAYERS);

  // ── the differential pixel census ────────────────────────────────────────────
  const setCam = async (zoom, center) => {
    await page.evaluate(({ z, c }) => window.__M__.jumpTo({ zoom: z, center: c }), { z: zoom, c: center });
    await sleep(1500);
  };
  const allOff = async () => page.evaluate((labels) => {
    let n = 0;
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim();
      if (labels.includes(t) && b.getAttribute('aria-pressed') === 'true') { b.click(); n++; }
    }
    return n;
  }, LAYERS);
  const toggle = async (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === l);
    if (!b) return { found: false };
    const before = b.getAttribute('aria-pressed');
    b.click();
    return { found: true, ariaPressedBefore: before, ariaPressedAfter: b.getAttribute('aria-pressed'), disabled: b.disabled };
  }, label);
  const pickModel = async (m) => page.evaluate((mm) => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === mm);
    if (!b) return { found: false };
    if (b.disabled) return { found: true, locked: true };
    b.click();
    return { found: true, locked: false };
  }, m);

  await setCam(5, [-72, 30]);   // NW Atlantic — open ocean + US east coast in frame

  for (const model of MODELS) {
    const pick = await pickModel(model);
    await sleep(6000);
    const rows = [];
    await allOff();
    await sleep(4000);
    const basePath = path.join(SHOTS, `base-${model}.png`);
    await page.screenshot({ path: basePath });
    const baseBuf = fs.readFileSync(basePath);

    for (const label of LAYERS) {
      const on = await toggle(label);
      // A raster tile fetch + decode is the slow path; give it a real budget.
      await sleep(9000);
      const shot = path.join(SHOTS, `${model}-${label.replace(/[^A-Za-z0-9]/g, '_')}.png`);
      await page.screenshot({ path: shot });
      const buf = fs.readFileSync(shot);
      let changed = null, variance = null, err = null;
      try {
        changed = +(diffFraction(baseBuf, buf, { threshold: 24, step: 7 }) * 100).toFixed(3);
        variance = +(varianceFraction(buf, { threshold: 30, step: 7 }) * 100).toFixed(3);
      } catch (e) { err = String(e).slice(0, 160); }
      const legend = await page.evaluate(() => {
        const el = document.body.innerText || '';
        return { hasUnitLabel: /\(ft\)|\(m\)|\(°F\)|\(°C\)|hPa|mm\/h|kt|mph/.test(el) };
      });
      rows.push({
        layer: label, ...on, changedPct: changed, variancePct: variance, decodeError: err,
        paints: changed !== null ? changed >= 0.5 : null, legendUnitVisible: legend.hasUnitLabel,
        shot: path.relative(OUT, shot),
      });
      console.log(`[${SUFFIX}] ${model} ${label}: changed=${changed}% variance=${variance}% aria=${on.ariaPressedAfter}`);
      await toggle(label);
      await sleep(2500);
    }
    result.models[model] = { pick, rows };
  }

  // ── geography sweep on one layer (Wind), incl. antimeridian + high latitude ───
  const GEO = [
    { name: 'Cocoa Beach FL', c: [-80.6, 28.35], z: 8 },
    { name: 'New York coast', c: [-73.5, 40.4], z: 7 },
    { name: 'Portugal', c: [-9.4, 38.7], z: 7 },
    { name: 'Morocco', c: [-9.8, 31.4], z: 7 },
    { name: 'El Salvador', c: [-89.3, 13.4], z: 7 },
    { name: 'Open Pacific', c: [-140, 10], z: 4 },
    { name: 'Antimeridian', c: [179.6, -17.6], z: 5 },
    { name: 'High latitude N', c: [-20, 68], z: 4 },
  ];
  await allOff(); await sleep(2500);
  await toggle('Wind'); await sleep(9000);
  const geoRows = [];
  for (const g of GEO) {
    await setCam(g.z, g.c);
    await sleep(8000);
    const shot = path.join(SHOTS, `geo-${g.name.replace(/[^A-Za-z0-9]/g, '_')}.png`);
    await page.screenshot({ path: shot });
    let variance = null; let err = null;
    try { variance = +(varianceFraction(fs.readFileSync(shot), { threshold: 30, step: 7 }) * 100).toFixed(3); }
    catch (e) { err = String(e).slice(0, 160); }
    const st = await page.evaluate(() => ({
      zoom: +window.__M__.getZoom().toFixed(2),
      center: window.__M__.getCenter().toArray().map((n) => +n.toFixed(3)),
      styleLoaded: window.__M__.isStyleLoaded(),
      layerCount: (window.__M__.getStyle().layers || []).length,
      sourceCount: Object.keys(window.__M__.getStyle().sources || {}).length,
    }));
    geoRows.push({ ...g, variancePct: variance, decodeError: err, ...st, shot: path.relative(OUT, shot) });
    console.log(`[${SUFFIX}] geo ${g.name}: variance=${variance}% layers=${st.layerCount}`);
  }
  result.geography = geoRows;

  result.consoleErrors = consoleErrors.slice(0, 120);
  result.pageErrors = pageErrors.slice(0, 60);
  result.netFail = netFail.slice(0, 60);
  result.finishedAt = new Date().toISOString();

  fs.writeFileSync(path.join(OUT, `coverage-${SUFFIX}.json`), JSON.stringify(result, null, 1));
  await ctx.close();   // flushes video
  await browser.close();
  console.log(`\n[${SUFFIX}] written -> coverage-${SUFFIX}.json`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

/**
 * Which `gl.getParameter` enums actually cost anything?
 *
 * `captureWebGLState` (WebGLStateIsolation.js) issues 27 getParameter calls per capture — 20 scalars
 * plus a 7-unit TEXTURE_BINDING_2D loop — once per render, per engine, and there are two engines.
 * The CPU profile attributes 1.4-1.5 s / ~4.5% to getParameter across 30 s.
 *
 * ⛔ DO NOT OPTIMISE A RENDERING-CORRECTNESS BOUNDARY ON A GUESS. Not all enums are equal: in
 * Chrome's command-buffer architecture some are answered from the client-side cache and some force a
 * synchronous round trip to the GPU process. If the cost is concentrated in a few enums, the fix is
 * to avoid those specific reads. If it is uniform, the fix has to be structural instead — and that
 * is a much bigger, riskier change that should not be started on an assumption.
 *
 * This runs against the REAL page with the REAL context under load, because a synthetic context on
 * an idle tab would answer a different question.
 *
 * Usage: HEADED=1 node GATE6_getParameter_microbench.js [url]
 */
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../../../frontend/package.json'));
const { chromium } = req('@playwright/test');

const TARGET = process.argv[2] || 'https://dev--rawsurf.netlify.app/map';
const LAYER = process.env.LAYER || 'Waves';

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('raw-surf-user', JSON.stringify({
        id: 'dev-mock-user-id', email: 'dev@rawsurf.com', full_name: 'Dev Mock',
        username: 'devmock', role: 'admin', subscription_tier: 'premium', is_admin: true
      }));
    } catch (e) {}
  });
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(20000);
  const btn = page.locator('button', { hasText: new RegExp(`^${LAYER}$`) }).first();
  await btn.click();
  await page.waitForTimeout(20000);   // let the field land so the context is under real load

  const result = await page.evaluate(() => {
    // The live MapLibre context — the same one captureWebGLState reads.
    const canvas = document.querySelector('canvas.maplibregl-canvas') || document.querySelector('canvas');
    const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
    if (!gl) return { error: 'no context' };

    const ENUMS = ['CURRENT_PROGRAM', 'FRAMEBUFFER_BINDING', 'BLEND', 'ACTIVE_TEXTURE',
      'ARRAY_BUFFER_BINDING', 'ELEMENT_ARRAY_BUFFER_BINDING', 'VIEWPORT',
      'BLEND_SRC_RGB', 'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA',
      'BLEND_EQUATION_RGB', 'BLEND_EQUATION_ALPHA',
      'DEPTH_TEST', 'DEPTH_WRITEMASK', 'STENCIL_TEST', 'SCISSOR_TEST', 'COLOR_WRITEMASK',
      'CULL_FACE', 'VERTEX_ARRAY_BINDING', 'TEXTURE_BINDING_2D'];

    const N = 2000;
    // ⛔ ORDER CONTROL. The first pass measured DEPTH_TEST at 0.05 us and SCISSOR_TEST at 64.8 us —
    // two boolean capability queries, read identically. That asymmetry is exactly what a
    // POSITION artefact looks like (e.g. the first read after queued GPU work flushes, later ones
    // are cheap). Measure each enum in three DIFFERENT random orders and keep the median: if the
    // expensive set follows the ENUM the effect is real; if it follows the POSITION it is an
    // artefact and every conclusion below is void.
    const PASSES = 3;
    const samples = new Map(ENUMS.map((n) => [n, []]));
    for (let p = 0; p < PASSES; p++) {
      const order = ENUMS.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let i = 0; i < 500; i++) gl.getParameter(gl.CURRENT_PROGRAM);  // warm up each pass
      for (const name of order) {
        const e = gl[name];
        if (e === undefined) continue;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) gl.getParameter(e);
        const t1 = performance.now();
        samples.get(name).push({ us: ((t1 - t0) * 1000) / N, pos: order.indexOf(name) });
      }
    }
    const out = ENUMS.map((name) => {
      const s = samples.get(name);
      if (!s.length) return { name, perCallUs: null, note: 'enum unavailable' };
      const us = s.map((x) => x.us).sort((a, b) => a - b);
      return {
        name,
        perCallUs: us[Math.floor(us.length / 2)],
        spread: `${us[0].toFixed(1)}-${us[us.length - 1].toFixed(1)}`,
        positions: s.map((x) => x.pos).join(',')
      };
    });

    // The whole capture shape, including the activeTexture churn the texture loop performs.
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
    const t2 = performance.now();
    for (let i = 0; i < 200; i++) {
      for (let u = 0; u < 7; u++) { gl.activeTexture(gl.TEXTURE0 + u); gl.getParameter(gl.TEXTURE_BINDING_2D); }
      gl.activeTexture(prevActive);
    }
    const t3 = performance.now();

    return { out, textureLoopUs: ((t3 - t2) * 1000) / 200, contextType: gl.constructor.name };
  });

  if (result.error) { console.log('ERROR:', result.error); await browser.close(); return; }

  const rows = result.out.filter((r) => r.perCallUs != null).sort((a, b) => b.perCallUs - a.perCallUs);
  console.log(`context: ${result.contextType}\n`);
  console.log('per-call cost, MEDIAN of 3 randomised-order passes (us, 2000 iterations each):\n');
  console.log('       median   range        positions   enum');
  for (const r of rows) {
    console.log(`  ${r.perCallUs.toFixed(3).padStart(8)} us  ${String(r.spread).padEnd(12)} [${String(r.positions).padEnd(8)}] ${r.name}`);
  }
  for (const r of result.out.filter((x) => x.perCallUs == null)) console.log(`       n/a  ${r.name} (${r.note})`);

  const scalars = rows.filter((r) => r.name !== 'TEXTURE_BINDING_2D');
  const sum20 = scalars.slice(0, 20).reduce((s, r) => s + r.perCallUs, 0);
  console.log(`\n  sum of the 20 scalar reads      : ${sum20.toFixed(1)} us per capture`);
  console.log(`  measured 7-unit texture loop    : ${result.textureLoopUs.toFixed(1)} us per capture`);
  console.log(`  => one captureWebGLState        : ~${(sum20 + result.textureLoopUs).toFixed(1)} us`);
  console.log(`  => two engines at 60 fps        : ~${(((sum20 + result.textureLoopUs) * 2 * 60) / 1000).toFixed(1)} ms/s`);
  console.log('\n★ If the cost is UNIFORM across enums, there is no cheap subset to drop and the fix must');
  console.log('  be structural. If it is CONCENTRATED, drop or cache those specific reads.');
  await browser.close();
})().catch((e) => { console.error('BENCH ERROR:', e.message); process.exit(1); });

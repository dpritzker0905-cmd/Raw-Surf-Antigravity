/**
 * uniform-read.js — read the LIVE alpha terms at Madeira instead of flipping levers at them.
 *
 * WHY A READ AND NOT A SWEEP. `__RAW_DISABLE_HALO_DAMP__` came back VOID BY CONSTRUCTION
 * (alpha-lever-halodamp.json: haloDamp=false in stock, washPreDamp==washEff==0.21, baseMaskDense
 * =true ⇒ the dense-base un-damp exempts it). A lever that cannot fire reads exactly like a term
 * that is innocent. Every uniform below is READABLE, so read it: a disabled term is eliminated at
 * zero risk of another void leg.
 *
 * THE ALPHA CHAIN, ENUMERATED FROM THE SHADER rather than from the prose count in §17
 * (which says "exactly three factors" and is true only of the MAIN path):
 *   main path  (WebGLMarineShaders.js:582+)  alpha = u_opacity
 *                                                  * maskFade(oceanAlpha)      [582-593]
 *                                                  * [u_heightAlphaEnabled]    [600-602]
 *                                                  * [u_edgeFeatherEnabled]    [605-611]
 *   band path  (471-500)                     bandAlpha = u_opacity * presence * vividness
 *                                                  * smoothstep(0.05,0.45,oceanAlpha)  <-- SOFTER
 *                                                  * [u_ribbonRadiusDeg ribbon] * [u_bandInlandGate]
 * The band path's coastal smoothstep is far wider than the main path's crisp (0.45,0.6), so WHICH
 * PATH RENDERS is itself a candidate explanation for a 32 px ramp. u_surfMode/u_ribbonRadiusDeg say.
 *
 * POSITIVE CONTROL (mandatory — a GL uniform read returns whatever was last set, so a program that
 * did not draw this frame returns a STALE value that looks perfectly valid): u_maskEdgeSharp read
 * off the program must equal engine._maskEdgeSharp, independently known to be 1 at this camera. If
 * it does not match, or the program/context is missing, the read is REFUSED rather than reported.
 * Read twice across two separate repaints and required to agree.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'uniform-read-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[uniform] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30 };

const FLOATS = [
  'u_opacity', 'u_maskEdgeSharp', 'u_theme', 'u_surfMode', 'u_is_estimated', 'u_debug_mode',
  'u_coastSDFEnabled', 'u_overlaySDFEnabled', 'u_coastErode', 'u_coastAA',
  'u_heightAlphaEnabled', 'u_heightAlphaLo', 'u_heightAlphaHi',
  'u_edgeFeatherEnabled', 'u_edgeFeatherWidth',
  'u_overlayMaskEnabled', 'u_overlayReplace', 'u_overlayTruthEnabled',
  'u_dataMaskGate', 'u_maskClipEnabled',
  'u_ribbonRadiusDeg', 'u_ribbonFloor', 'u_bandInlandGate',
];
const VEC2S = ['u_dataBounds_min', 'u_dataBounds_max', 'u_maskBounds_min', 'u_maskBounds_max',
  'u_overlayBounds_min', 'u_overlayBounds_max'];

const readUniforms = ({ floats, vec2s }) => new Promise((resolve) => {
  const m = window.map;
  const fn = () => {
    m.off('render', fn);
    const e = window.__MARINE_ENGINE__ || null;
    if (!e) return resolve({ ok: false, why: 'no __MARINE_ENGINE__ handle' });
    let gl = null;
    try { gl = m.painter && m.painter.context && m.painter.context.gl; } catch (err) {}
    if (!gl) { const c = m.getCanvas(); gl = c.getContext('webgl2') || c.getContext('webgl'); }
    if (!gl) return resolve({ ok: false, why: 'no GL context' });
    const out = { ok: true, programs: {} };
    for (const pname of ['heatmapProgram', 'drawProgram']) {
      const prog = e[pname];
      if (!prog) { out.programs[pname] = { present: false }; continue; }
      const vals = {};
      for (const u of floats) {
        const loc = gl.getUniformLocation(prog, u);
        vals[u] = loc ? gl.getUniform(prog, loc) : null;   // null => not present/optimised out
      }
      for (const u of vec2s) {
        const loc = gl.getUniformLocation(prog, u);
        const v = loc ? gl.getUniform(prog, loc) : null;
        vals[u] = v ? Array.from(v) : null;
      }
      out.programs[pname] = { present: true, vals };
    }
    // engine-side truth for the control + the texel arithmetic
    out.engine = {
      maskEdgeSharp: e._maskEdgeSharp,
      cachedMaskTexDims: e._cachedMaskTexDims || null,
      cachedMaskBounds: e._cachedMaskBounds || null,
      overlayTexDims: e._overlayMaskTexDims || e._overlayTexDims || null,
      lastZoom: e._lastZoom !== undefined ? e._lastZoom : null,
    };
    const g = window.__RAW_GPU__ || {};
    out.gpu = {
      overlayMask: g.overlayMask || null,
      blendBoth: g.blendBoth || null,
      haloDamp: g.haloDamp === undefined ? null : g.haloDamp,
      washPreDamp: g.washPreDamp === undefined ? null : g.washPreDamp,
      washEff: g.washEff === undefined ? null : g.washEff,
      maskId: g.maskId || null,
      maskDelivered: g.maskDelivered || null,
    };
    const rect = m.getContainer().getBoundingClientRect();
    out.view = { zoom: +m.getZoom().toFixed(3), dpr: m.getCanvas().width / rect.width,
      cssW: rect.width, cssH: rect.height };
    resolve(out);
  };
  m.on('render', fn); m.triggerRepaint();
});

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
  await page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && (b.getAttribute('aria-pressed') === 'true') !== want) b.click();
  }, true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);

  const A = await page.evaluate(readUniforms, { floats: FLOATS, vec2s: VEC2S });
  await page.waitForTimeout(2000);
  const B = await page.evaluate(readUniforms, { floats: FLOATS, vec2s: VEC2S });
  await ctx.close();
  await browser.close();

  if (!A.ok || !B.ok) { log('REFUSED: ' + (A.why || B.why)); process.exit(1); }
  const hp = A.programs.heatmapProgram;
  if (!hp.present) { log('REFUSED: engine has no heatmapProgram handle'); process.exit(1); }

  // ── CONTROLS ──────────────────────────────────────────────────────────────
  const ctrlGL = hp.vals.u_maskEdgeSharp;
  const ctrlEngine = A.engine.maskEdgeSharp;
  const ctrlOk = ctrlGL !== null && Number(ctrlGL) === Number(ctrlEngine);
  const stable = JSON.stringify(A.programs.heatmapProgram.vals) === JSON.stringify(B.programs.heatmapProgram.vals);
  log(`view: zoom=${A.view.zoom} dpr=${A.view.dpr} ovl=${A.gpu.overlayMask && A.gpu.overlayMask.reason}`);
  log('');
  log('CONTROLS');
  log(`  u_maskEdgeSharp(GL)=${ctrlGL}  engine._maskEdgeSharp=${ctrlEngine}  -> ${ctrlOk ? 'MATCH (read is live)' : 'MISMATCH - READ IS STALE OR WRONG PROGRAM'}`);
  log(`  two reads across separate repaints agree: ${stable}`);
  if (!ctrlOk || !stable) {
    log('  => REFUSED. Not reporting uniform values from an unverified read.');
    fs.writeFileSync(path.join(outdir, 'uniform-read.json'), JSON.stringify({ A, B, ctrlOk, stable }, null, 1));
    process.exit(1);
  }
  log('');
  log('ALPHA CHAIN (heatmapProgram)');
  const v = hp.vals;
  const show = (u) => log(`  ${u.padEnd(24)} = ${JSON.stringify(v[u])}`);
  ['u_opacity', 'u_maskEdgeSharp', 'u_coastSDFEnabled', 'u_overlaySDFEnabled',
    'u_heightAlphaEnabled', 'u_heightAlphaLo', 'u_heightAlphaHi',
    'u_edgeFeatherEnabled', 'u_edgeFeatherWidth',
    'u_surfMode', 'u_ribbonRadiusDeg', 'u_ribbonFloor', 'u_bandInlandGate',
    'u_overlayMaskEnabled', 'u_overlayReplace', 'u_overlayTruthEnabled',
    'u_dataMaskGate', 'u_maskClipEnabled', 'u_coastErode', 'u_coastAA'].forEach(show);
  log('');
  log('VERDICT PER TERM');
  const term = (name, live, why) => log(`  ${name.padEnd(26)} ${live ? 'LIVE  <-- candidate' : 'OFF   eliminated by reading'}   ${why}`);
  term('maskFade (crisp branch)', true, `maskEdgeSharp=${v.u_maskEdgeSharp}, SDF=${v.u_coastSDFEnabled}/${v.u_overlaySDFEnabled}`);
  term('height-keyed smoothstep', Number(v.u_heightAlphaEnabled) > 0.5, `u_heightAlphaEnabled=${v.u_heightAlphaEnabled} lo/hi=${v.u_heightAlphaLo}/${v.u_heightAlphaHi}`);
  term('grid-edge feather', Number(v.u_edgeFeatherEnabled) > 0.5, `u_edgeFeatherEnabled=${v.u_edgeFeatherEnabled} width=${v.u_edgeFeatherWidth}`);
  term('band ribbon (band path)', Number(v.u_ribbonRadiusDeg) > 0.0, `u_ribbonRadiusDeg=${v.u_ribbonRadiusDeg} surfMode=${v.u_surfMode}`);

  // ── TEXEL ARITHMETIC: can oceanAlpha itself ramp over ~32 device px? ────────
  const mb = v.u_maskBounds_min && v.u_maskBounds_max ? { w: v.u_maskBounds_min[0], e: v.u_maskBounds_max[0] } : null;
  const ob = v.u_overlayBounds_min && v.u_overlayBounds_max ? { w: v.u_overlayBounds_min[0], e: v.u_overlayBounds_max[0] } : null;
  const degPerDevicePx = 360 / (256 * Math.pow(2, A.view.zoom)) / A.view.dpr;
  log('');
  log('TEXEL ARITHMETIC (can oceanAlpha itself ramp 32 device px?)');
  log(`  deg per DEVICE px at z${A.view.zoom}: ${degPerDevicePx.toExponential(3)}`);
  const rep = (label, bounds, dims) => {
    if (!bounds || !dims || !dims.w) { log(`  ${label.padEnd(16)} bounds/dims unavailable (${JSON.stringify(bounds)} / ${JSON.stringify(dims)})`); return; }
    const degPerTexel = (bounds.e - bounds.w) / dims.w;
    log(`  ${label.padEnd(16)} span=${(bounds.e - bounds.w).toFixed(3)}deg / ${dims.w}px => ${degPerTexel.toExponential(3)} deg/texel`
      + ` = ${(degPerTexel / degPerDevicePx).toFixed(2)} DEVICE PX per texel`);
  };
  rep('base mask', mb, A.engine.cachedMaskTexDims);
  rep('overlay mask', ob, A.engine.overlayTexDims);
  log('  (a bilinear edge ramps over ~1 texel; a 32 px ramp needs ~32 px/texel)');

  fs.writeFileSync(path.join(outdir, 'uniform-read.json'), JSON.stringify({ A, B, ctrlOk, stable }, null, 1));
  log('');
  log('written: ' + path.join(outdir, 'uniform-read.json'));
})().catch((e) => { console.error(e); process.exit(1); });

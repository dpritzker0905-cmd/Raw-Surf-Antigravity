// Real-GPU agreement check for the GL state shadow (WebGLStateIsolation.readShadowedState, kill
// window.__RAW_DISABLE_GL_STATE_SHADOW__). With window.__RAW_GL_SHADOW_AUDIT__ = true set before boot, every
// captureWebGLState ALSO reads the driver (getParameter) and counts, per value, whether MapLibre's painter.context shadow
// agreed; this drives the real app through marine + wind renders (scrubs, layer and model switches, zoom) on the machine's
// GPU (Chrome, ANGLE d3d11) and prints the tally. Pass = mismatches == 0 with shadowed captures from BOTH engines.
//
// Offline only (the synthetic backend; never the live box):
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   PORT=<synthetic backend port> node frontend/scripts/visual-lab/gl_shadow_agreement.js   (OUT=<file.json> to save)
const fs = require('fs');
const L = require('../offline-backend/ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4103);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}
async function pressed(page, text) {
  return page.evaluate((t) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === t), text);
}
async function keys(page, key, n) {
  const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(120); }
}
const audit = (page) => page.evaluate(() => {
  const a = (window.__RAW_GPU__ && window.__RAW_GPU__.glShadowAudit) || null;
  return a ? JSON.parse(JSON.stringify(a)) : null;
});

(async () => {
  const { browser, page, log } = await L.launch({ port: PORT });
  await page.addInitScript(() => {
    window.__RAW_GL_SHADOW_AUDIT__ = true;
    // Which engine made each audited capture: wrap both engines' render and attribute the audit's capture count delta.
    const per = (window.__GLSA_PER_ENGINE__ = { marine: { renders: 0, captures: 0 }, wind: { renders: 0, captures: 0 } });
    const wrap = (name, key) => {
      const e = window[name];
      if (!e || e.__glsaWrapped) return;
      const orig = e.render;
      e.render = function (...args) {
        const a = window.__RAW_GPU__ && window.__RAW_GPU__.glShadowAudit; const before = a ? a.captures : 0;
        try { return orig.apply(this, args); } finally {
          const a2 = window.__RAW_GPU__ && window.__RAW_GPU__.glShadowAudit;
          per[key].renders++; per[key].captures += (a2 ? a2.captures : 0) - before;
        }
      };
      e.__glsaWrapped = true;
    };
    setInterval(() => { wrap('__MARINE_ENGINE__', 'marine'); wrap('__WIND_ENGINE__', 'wind'); }, 200);
  });
  const out = { env: { PORT, startedUtc: new Date().toISOString() }, renderer: null, steps: [] };
  try {
    await L.openMap(page); await L.jump(page, -75, 30, 3);
    out.renderer = await page.evaluate(() => {
      const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) } : null;
    });
    if (!(await pressed(page, 'Waves'))) await clickExact(page, 'Waves');
    await sleep(8000);
    const steps = [
      ['scrub +6h', () => keys(page, 'ArrowRight', 6)], ['scrub +2d', () => keys(page, 'PageUp', 2)],
      ['Swell', () => clickExact(page, 'Swell')], ['EURO', () => clickExact(page, 'EURO')],
      ['Wind on', async () => { if (!(await pressed(page, 'Wind'))) await clickExact(page, 'Wind'); }],
      ['scrub +9h (wind+marine)', () => keys(page, 'ArrowRight', 9)], ['ICON', () => clickExact(page, 'ICON')],
      ['zoom 7', () => L.jump(page, -80, 27, 7)], ['scrub -1d', () => keys(page, 'PageDown', 1)],
      ['zoom 3', () => L.jump(page, -75, 30, 3)], ['Home', () => keys(page, 'Home', 1)],
    ];
    for (const [label, act] of steps) {
      await act(); await sleep(4000);
      out.steps.push({ label, audit: await audit(page) });
      const a = out.steps[out.steps.length - 1].audit || {};
      const pe = await page.evaluate(() => window.__GLSA_PER_ENGINE__);
      console.log(`${label.padEnd(26)} captures ${a.captures || 0}  shadowed ${a.shadowed || 0}  checks ${a.checks || 0}  mismatches ${a.mismatches || 0}  marine ${pe.marine.captures}  wind ${pe.wind.captures}`);
    }
    out.final = await audit(page);
    out.perEngine = await page.evaluate(() => window.__GLSA_PER_ENGINE__);
  } finally {
    out.pageErrors = log.errors.slice(0, 10);
    await browser.close();
  }
  const f = out.final || {};
  const pe = out.perEngine || { marine: {}, wind: {} };
  out.pass = (f.shadowed || 0) > 0 && (f.mismatches || 0) === 0 && (pe.marine.captures || 0) > 0 && (pe.wind.captures || 0) > 0;
  console.log('renderer', JSON.stringify(out.renderer));
  console.log('per engine', JSON.stringify(pe));
  console.log('final', JSON.stringify(f));
  console.log(out.pass ? 'PASS: the shadow agreed with the driver on every shadowed read' : 'FAIL');
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
  process.exit(out.pass ? 0 : 1);
})();

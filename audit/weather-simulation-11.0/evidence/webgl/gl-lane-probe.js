/**
 * GL LANE PROBE — why `test.skip(!hasWebGL, ...)` fires on GitHub runners, and what fixes it.
 *
 * Audit-only. Does not touch the app. Run:
 *   cd frontend && node ../audit/weather-simulation-11.0/evidence/webgl/gl-lane-probe.js
 *
 * Every arm runs with --disable-gpu, which is what makes a machine WITH a GPU behave like a
 * GitHub-hosted runner WITHOUT one: Chrome falls back to its software rasteriser (SwiftShader).
 * That fallback is the thing under test — Chrome 119+ deprecated automatic SwiftShader for WebGL.
 *
 * It asks the page EXACTLY what frontend/e2e/weather-simulation.spec.js:371-378 asks, then goes one
 * step further and draws, because a context that exists but paints black would still fail the
 * pixel-truth oracle downstream.
 */
// Resolve from the frontend's node_modules: this script lives outside that tree, so a bare
// require() would resolve relative to THIS directory and fail.
const path = require('path');
const FRONTEND = path.resolve(__dirname, '../../../../frontend');
const { chromium } = require(require.resolve('@playwright/test', { paths: [FRONTEND] }));

const PROBE = () => {
  const out = { hasWebGL: false, renderer: null, vendor: null, drewNonBlack: false, err: null };
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    out.hasWebGL = !!gl;
    if (!gl) return out;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    out.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    // Actually PAINT: a context that cannot rasterise is useless to the pixel oracle.
    gl.clearColor(0.0, 0.6, 0.4, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.pixel = Array.from(px);
    out.drewNonBlack = px[1] > 100;
  } catch (e) { out.err = String(e && e.message); }
  return out;
};

const ARMS = [
  { name: 'A  CI TODAY (headless shell, no flags)', opts: { args: ['--disable-gpu'] } },
  { name: 'B  + --enable-unsafe-swiftshader', opts: { args: ['--disable-gpu', '--enable-unsafe-swiftshader'] } },
  { name: 'C  channel:chromium (new headless)', opts: { channel: 'chromium', args: ['--disable-gpu'] } },
  { name: 'D  channel:chromium + swiftshader', opts: { channel: 'chromium', args: ['--disable-gpu', '--enable-unsafe-swiftshader'] } },
];

(async () => {
  const rows = [];
  for (const arm of ARMS) {
    let browser = null, res = null;
    try {
      browser = await chromium.launch({ headless: true, ...arm.opts });
      const page = await browser.newPage();
      await page.setContent('<html><body></body></html>');
      res = await page.evaluate(PROBE);
    } catch (e) {
      res = { launchError: String(e && e.message).split('\n')[0].slice(0, 110) };
    } finally { if (browser) await browser.close().catch(() => {}); }
    rows.push({ arm: arm.name, ...res });
    const mark = res.hasWebGL ? (res.drewNonBlack ? 'WEBGL + PAINTS' : 'webgl, BLACK') : 'NO WEBGL';
    console.log(`${arm.name.padEnd(42)} ${mark.padEnd(16)} ${res.renderer || res.launchError || res.err || ''}`);
  }
  console.log('\n--- verdict ---');
  const a = rows[0], best = rows.find(r => r.hasWebGL && r.drewNonBlack);
  if (!a.hasWebGL && best) {
    console.log(`REPRODUCED: arm A (what CI runs today) has NO WebGL -> the spec's test.skip fires.`);
    console.log(`FIX: "${best.arm.trim()}" gives a context that actually paints (${best.renderer}).`);
  } else if (a.hasWebGL) {
    console.log('Arm A already has WebGL here — this machine is NOT reproducing the runner. Re-check flags.');
  } else {
    console.log('No arm produced a painting context. Escalate: the runner needs a different strategy.');
  }
})();

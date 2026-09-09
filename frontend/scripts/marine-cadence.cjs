// Diagnostic only: separate engine wall time, render-event intervals, capture, mask and video
// cost. This cannot pass a visual or scientific release gate. Run against the existing CI app.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('../node_modules/@playwright/test');
const { measureMarinePasses } = require('./marine-render-profiler.cjs');
const out = path.resolve(process.argv[2] || '/tmp/zoomlab-out');
const base = process.env.ZL_BASE || 'http://localhost:3009';

async function measurePage(page) {
  await page.goto(base + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 90000 });
  await page.evaluate(() => {
    const decline = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Decline');
    if (decline) decline.click();
  });
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('button')];
    const waves = buttons.find(b => (b.title || b.getAttribute('aria-label') || b.textContent).trim() === 'Waves');
    if (waves) return true;
    const expand = buttons.find(b => /weather controls/i.test((b.getAttribute('aria-label') || '') + b.title) &&
      !/collapse/i.test((b.getAttribute('aria-label') || '') + b.title));
    if (expand) expand.click();
    return false;
  }, null, { timeout: 45000 });
  await page.evaluate(() => {
    const waves = [...document.querySelectorAll('button')].find(b =>
      (b.title || b.getAttribute('aria-label') || b.textContent).trim() === 'Waves');
    if (waves.getAttribute('aria-pressed') !== 'true') waves.click();
    window.map.jumpTo({ center: [-80.2, 28.33], zoom: 6.862 });
  });
  await page.waitForFunction(() => window.__MARINE_ENGINE__?._waveData?.waveGrid?.vectors?.length > 0,
    null, { timeout: 90000 });
  await page.waitForTimeout(10000);
  return page.evaluate(async () => {
    const engine = window.__MARINE_ENGINE__, map = window.map, gl = map.painter.context.gl;
    const canvas = map.getCanvas(), ids = new WeakMap(); let nextId = 0;
    const id = object => { if (!object) return null; if (!ids.has(object)) ids.set(object, ++nextId); return ids.get(object); };
    const identity = () => ({ resident: id(engine._waveData), grid: id(engine._waveData?.waveGrid),
      coarse: id(engine._coarseBaseData), mask: id(engine._cachedMaskTex), overlay: id(engine._overlayMaskTex),
      bounds: engine._waveData?.bounds, maskBounds: engine._cachedMaskBounds, maskDims: engine._cachedMaskTexDims,
      overlayBounds: engine._overlayMaskBounds, basemapPaintAt: window.__RAW_GPU__?.basemapWaterMask?.at });
    const digest = async () => {
      const grid = engine._waveData?.waveGrid;
      const bytes = new TextEncoder().encode(JSON.stringify(grid));
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    };
    const before = identity(), beforeHash = await digest();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const setup = { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      attributes: gl.getContextAttributes(), width: canvas.width, height: canvas.height,
      build: window.__RAW_GPU__?.build, identity: before, gridSha256: beforeHash,
      validTime: engine._waveData?.waveGrid?.valid_time, servedTime: engine._waveData?.waveGrid?.served_valid_time,
      product: engine._waveData?.waveGrid?.productId, model: engine._waveData?.waveGrid?.__sourceModel };
    const small = document.createElement('canvas'); small.width = 160; small.height = Math.round(160 * canvas.height / canvas.width);
    const ctx = small.getContext('2d', { willReadFrequently: true });
    const originalRender = engine.render; let renderMs = 0, renderCalls = 0, suppressMarine = false;
    engine.render = function(...args) {
      // A labeled counterfactual in this disposable page only; never a visual acceptance leg.
      if (suppressMarine) return;
      const t = performance.now();
      try { return originalRender.apply(this, args); }
      finally { renderMs += performance.now() - t; renderCalls++; }
    };
    const blocks = [];
    try {
      // ABBA holds the camera and records identity on every event. A data/mask change refuses
      // the paired comparison instead of being mistaken for observer overhead.
      for (const mode of ['baseline', 'capture', 'capture', 'baseline', 'basemap_only', 'baseline']) {
        suppressMarine = mode === 'basemap_only';
        const frames = await new Promise((resolve, reject) => {
          const rows = []; let previous = performance.now(); renderMs = 0; renderCalls = 0;
          const timeout = setTimeout(() => { map.off('render', onRender); reject(Error('Too few render events')); }, 90000);
          const onRender = () => {
            try {
              const t = performance.now(), gpu = window.__RAW_GPU__ || {};
              const row = { intervalMs: t - previous, renderMs, renderCalls, marineSuppressed: suppressMarine,
                drawCalls: gpu.drawCallsPerFrame, heatmap: gpu.opacity?.heatmap, mult: gpu.opacity?.mult,
                coarseBridge: gpu.coarseBridgeActive, identity: identity() };
              previous = t; renderMs = 0; renderCalls = 0;
              if (mode === 'capture') {
                ctx.drawImage(canvas, 0, 0, small.width, small.height); const transfer = performance.now();
                const data = ctx.getImageData(0, 0, small.width, small.height).data; const read = performance.now();
                let sum = 0; for (let i = 0; i < data.length; i += 4) sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
                Object.assign(row, { transferMs: transfer - t, readMs: read - transfer,
                  analysisMs: performance.now() - read, L: sum / (data.length / 4) });
              }
              rows.push(row);
              if (rows.length === 12) { clearTimeout(timeout); map.off('render', onRender); resolve(rows); }
            } catch (error) { clearTimeout(timeout); map.off('render', onRender); reject(error); }
          };
          map.on('render', onRender); map.triggerRepaint();
        });
        blocks.push({ mode, frames });
      }
      const container = map.getContainer();
      const points = Array.from({ length: 200 }, (_, i) => {
        const p = map.unproject([(Math.floor(i / 5) + .5) / 40 * container.clientWidth,
          [.15, .3, .5, .7, .85][i % 5] * container.clientHeight]);
        return { lng: p.lng, lat: p.lat };
      });
      // Record finish separately, then force a CPU readback before profiling the mask. A zero
      // finish wall time alone is insufficient evidence that the later probe has no GPU wait.
      const finishStart = performance.now(); gl.finish(); const finishMs = performance.now() - finishStart;
      const barrierStart = performance.now(), readTarget = gl.READ_FRAMEBUFFER ?? gl.FRAMEBUFFER;
      const readBinding = gl.READ_FRAMEBUFFER_BINDING ?? gl.FRAMEBUFFER_BINDING;
      const previousRead = gl.getParameter(readBinding);
      try {
        gl.bindFramebuffer(readTarget, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      } finally { gl.bindFramebuffer(readTarget, previousRead); }
      const readbackBarrierMs = performance.now() - barrierStart, probes = [];
      let samples, expectedSamples;
      for (let repeat = 0; repeat < 3; repeat++) {
        const operations = [], originals = {};
        for (const name of ['getParameter', 'bindFramebuffer', 'framebufferTexture2D', 'checkFramebufferStatus', 'readPixels']) {
          originals[name] = gl[name];
          gl[name] = function(...args) {
            const t = performance.now();
            try { return originals[name].apply(this, args); }
            finally { operations.push({ name, ms: performance.now() - t,
              ...(name === 'readPixels' ? { x: args[0], y: args[1], width: args[2], height: args[3] } : {}) }); }
          };
        }
        const start = performance.now();
        try { samples = engine.probeMaskGPU(points, gl); }
        finally { for (const name of Object.keys(originals)) gl[name] = originals[name]; }
        const ms = performance.now() - start, encoded = JSON.stringify(samples);
        if (expectedSamples === undefined) expectedSamples = encoded;
        if (encoded !== expectedSamples) throw Error('Repeated mask probes changed without a draw');
        probes.push({ ms, operations });
      }
      const probeMs = probes[0].ms, glError = gl.getError();
      const after = identity(), afterHash = await digest();
      return { setup, blocks, after, afterHash, finishMs, readbackBarrierMs, probeMs, probes, glError, probeCount: samples?.length,
        known: samples?.filter(s => s.effective != null).length, water: samples?.filter(s => s.effective >= 128).length,
        stable: beforeHash === afterHash && [after, ...blocks.flatMap(b => b.frames.map(f => f.identity))]
          .every(value => JSON.stringify(value) === JSON.stringify(before)) };
    } finally { engine.render = originalRender; }
  });
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const launchArgs = ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const launch = args => chromium.launch({ headless: true, args,
    ...(process.env.HANDOFF_BROWSER_CHANNEL ? { channel: process.env.HANDOFF_BROWSER_CHANNEL } : {}) });
  const capability = async browser => {
    const page = await browser.newPage();
    try {
      return { browserVersion: browser.version(), ...await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
        if (!gl) return { webgl2: false, timerAvailable: false };
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { webgl2: true, timerAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          extensions: gl.getSupportedExtensions() };
      }) };
    } finally { await page.close(); }
  };
  // Chromium may classify GPU timers as developer extensions. Preserve the default-browser
  // control; the developer flag applies only to this diagnostic, never the visual verdict.
  const capabilities = [], controlBrowser = await launch(launchArgs);
  try { capabilities.push({ launchArgs: [...launchArgs], ...await capability(controlBrowser) }); }
  finally { await controlBrowser.close(); }
  launchArgs.push('--enable-webgl-developer-extensions');
  const browser = await launch(launchArgs);
  const results = [];
  try {
    capabilities.push({ launchArgs, ...await capability(browser) });
    fs.writeFileSync(path.join(out, 'gpu-capability.json'), JSON.stringify({ sourceCommit: process.env.GITHUB_SHA,
      diagnosticOnly: true, capabilities }, null, 2) + '\n');
    assert(capabilities[1].timerAvailable, 'GPU timers unavailable with developer extensions; pass cost remains unmeasured');
    if (process.argv.includes('--capability-only')) return;
    for (const video of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
        ...(video ? { recordVideo: { dir: out, size: { width: 1280, height: 800 } } } : {}) });
      try {
        await context.addInitScript(() => {
          const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
            addEventListener: () => {}, removeEventListener: () => {},
            getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
          Object.defineProperty(navigator, 'serviceWorker', { get: () => mockSW, configurable: true });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' || m.text().includes('Render error')) errors.push(m.text().slice(0, 400)); });
        const measurement = await measurePage(page);
        const result = { video, errors, ...measurement }; results.push(result);
        const write = () => fs.writeFileSync(path.join(out, 'cadence.json'), JSON.stringify({
          diagnosticOnly: true, sourceCommit: process.env.GITHUB_SHA, launchArgs, results }, null, 2) + '\n');
        write();
        try { result.renderProfile = await page.evaluate(measureMarinePasses); }
        catch (error) { result.renderProfileError = error.message; write(); throw error; }
        write();
        console.log(JSON.stringify({ video, renderer: measurement.setup.renderer, stable: measurement.stable,
          blocks: measurement.blocks.map(b => ({ mode: b.mode,
            intervalMs: b.frames.slice(2).reduce((s, f) => s + f.intervalMs, 0) / 10,
            engineMs: b.frames.slice(2).reduce((s, f) => s + f.renderMs, 0) / 10 })),
          finishMs: measurement.finishMs, barrierMs: measurement.readbackBarrierMs,
          probes: measurement.probes.map(p => ({ ms: p.ms, reads: p.operations.filter(o => o.name === 'readPixels').length })), errors }));
        assert.deepEqual(errors, [], 'Browser errors invalidate the cadence comparison');
        assert(measurement.stable, 'Data/mask identity changed during the comparison');
        assert.equal(measurement.probeCount, 200, 'Missing water samples');
        assert.equal(measurement.glError, 0, 'GPU error invalidates the diagnostic');
        assert(measurement.blocks.filter(b => b.mode !== 'basemap_only').every(b =>
          b.frames.slice(2).every(f => f.renderCalls > 0 && f.drawCalls > 0)), 'Marine drawing was not observed');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log('Cadence diagnostic recorded. This does not grade visual continuity or scientific accuracy.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

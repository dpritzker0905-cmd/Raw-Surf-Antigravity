import WebGLMarineEngine from '../../../frontend/src/components/map/WebGLMarineEngine';
import maplibregl from 'maplibre-gl';
import { createCustomLayer } from '../../../frontend/src/components/map/WebGLMarineCustomLayer';

const run = document.getElementById('run');
const report = document.getElementById('report');
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
const mercY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const bounds = { west: -90, south: 20, east: -80, north: 30 };
const matrix = new Float32Array(16);
matrix[0] = 72; matrix[5] = -2 / (mercY(20) - mercY(30));
matrix[10] = 1; matrix[12] = -19; matrix[13] = 1 - matrix[5] * mercY(30); matrix[15] = 1;
const vectors = Array.from({ length: 289 }, (_, i) => ({
  lng: -90 + (i % 17) * 10 / 16, lat: 30 - Math.floor(i / 17) * 10 / 16,
  u: 1, v: 0, speed: 2.4, direction: 90, period: 9, is_valid: true,
}));
const grid = { cols: 17, rows: 17, bounds, vectors, __sourceModel: 'GFS',
  __componentLayer: 'waves', hourOffset: 0, validTime: '2026-10-06T18:00:00Z',
  productId: 'synthetic-offline-profile', isEstimated: true };

run.addEventListener('click', async () => {
  run.disabled = true;
  report.textContent = 'Running offline synthetic renderer cases…';
  const result = { physicalForecast: false, fullMap: false, gpuCompletion: 'unmeasured',
    queryTimings: 'instrumented CPU call durations; not GPU elapsed time', framesPerCase: 60, cases: [] };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    document.getElementById('canvases').replaceChildren(canvas);
    const rawGL = canvas.getContext('webgl2');
    if (!rawGL) throw new Error('WebGL2 unavailable');
    for (const particleRes of document.getElementById('reverse').checked ? [32, 296] : [296, 32]) {
      let measuring = false;
      const counters = {}, functions = new Map();
      const tracked = new Set(['getParameter', 'isEnabled', 'checkFramebufferStatus', 'framebufferTexture2D',
        'getUniformLocation', 'drawElements', 'drawArrays', 'texImage2D', 'texSubImage2D']);
      const gl = new Proxy(rawGL, { get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        if (!functions.has(key)) functions.set(key, (...args) => {
          if (!measuring || !tracked.has(key)) return value.apply(target, args);
          const start = performance.now();
          try { return value.apply(target, args); }
          finally {
            const counter = counters[key] || (counters[key] = { calls: 0, cpuMs: 0 });
            counter.calls++; counter.cpuMs += performance.now() - start;
          }
        });
        return functions.get(key);
      } });
      const engine = new WebGLMarineEngine();
      engine.particleRes = particleRes;
      try {
        engine.init(gl);
        engine.setWaveData(gl, grid, null);
        if (!engine._waveData) throw new Error('Synthetic resident was not encoded');
        window.__RAW_GPU__.frameTimeHistogram = [0, 0, 0, 0, 0];
        for (let i = 0; i < 12; i++) {
          await nextFrame(); engine.render(gl, matrix, 256, 128, 9, 'dark', [-90, 20, -80, 30], 1);
        }
        const cpu = [], cadence = [];
        let last;
        measuring = true;
        for (let i = 0; i < 60; i++) {
          await nextFrame();
          const start = performance.now();
          if (last !== undefined) cadence.push(start - last);
          last = start;
          engine.render(gl, matrix, 256, 128, 9, 'dark', [-90, 20, -80, 30], 1);
          cpu.push(performance.now() - start);
        }
        measuring = false;
        result.cases.push({ particleRes, cpuP50Ms: percentile(cpu, 0.5), cpuP95Ms: percentile(cpu, 0.95),
          cadenceP50Ms: percentile(cadence, 0.5), cadenceP95Ms: percentile(cadence, 0.95),
          glError: rawGL.getError(), calls: counters,
          histogramLifetime: [...window.__RAW_GPU__.frameTimeHistogram] });
      } finally { measuring = false; engine.dispose(gl); }
    }
    result.completed = true;
  } catch (error) { result.completed = false; result.error = String(error.message); }
  report.textContent = JSON.stringify(result, null, 2);
  run.disabled = false;
});

document.getElementById('map-run').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  report.textContent = 'Running actual MapLibre custom layer on an offline synthetic field…';
  const [width, height] = document.getElementById('size').value.split('x').map(Number);
  const container = document.createElement('div');
  container.style.cssText = `width:${width}px;height:${height}px;position:relative;`;
  document.getElementById('canvases').replaceChildren(container);
  const map = new maplibregl.Map({ container, center: [-85, 25], zoom: 7,
    interactive: false, attributionControl: false,
    style: { version: 8, sources: {}, layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#314353' } }] } });
  const result = { fullApp: false, physicalForecast: false, actualMapLibre: true,
    cssSize: [width, height], gpuCompletion: 'unmeasured', frames: 0, projectionLengths: [], skips: [], errors: [] };
  map.on('error', error => result.errors.push(String(error.error?.message || error.message)));
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Offline style did not load')), 15000);
      map.on('load', resolve);
    });
    clearTimeout(timer);
    result.canvasSize = [map.getCanvas().width, map.getCanvas().height];
    const engine = new WebGLMarineEngine();
    const baseRender = engine.render;
    const cpu = [], cadence = [];
    let count = 0, last;
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Bounded frame collection timed out')), 15000);
      engine.render = function(...args) {
        const start = performance.now();
        try { baseRender.apply(this, args); }
        catch (error) { reject(error); throw error; }
        if (count++ < 12 || cpu.length >= 60) return;
        cpu.push(performance.now() - start);
        if (last !== undefined) cadence.push(start - last);
        last = start;
        result.projectionLengths.push(args[1]?.length ?? null);
        result.skips.push(window.__RAW_GPU__?.layer?.skip ?? null);
        if (cpu.length === 60) { result.glError = args[0].getError(); resolve(); }
      };
      const ref = current => ({ current });
      const layer = createCustomLayer(engine, ref(true), ref(map), ref(grid), ref(null),
        ref(() => reject(new Error('Actual layer reported a hard error'))), ref('dark'), ref(null),
        ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
      map.addLayer(layer);
    });
    result.frames = cpu.length;
    result.cpuP50Ms = percentile(cpu, 0.5); result.cpuP95Ms = percentile(cpu, 0.95);
    result.cadenceP50Ms = percentile(cadence, 0.5); result.cadenceP95Ms = percentile(cadence, 0.95);
    result.completed = true;
  } catch (error) { result.completed = false; result.error = String(error.message); }
  finally { clearTimeout(timer); map.remove(); button.disabled = false; }
  report.textContent = JSON.stringify(result, null, 2);
});
import { beginMarineMainThreadTiming } from '../../../frontend/src/components/map/marineMainThreadTiming';

document.getElementById('gap-run').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = { fullApp: false, physicalForecast: false, syntheticMainThreadCalibration: true,
    gpuCompletionMeasured: false, cases: [] };
  try {
    const order = document.getElementById('reverse').checked ? [true, false] : [false, true];
    for (const block of order) {
      const start = performance.now();
      const timing = beginMarineMainThreadTiming(start, window.PerformanceObserver);
      let timer;
      const gaps = [], cpu = [];
      try {
        let last, frames = 0;
        await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Bounded animation capture timed out')), 10000);
          const frame = now => {
            if (last !== undefined) gaps.push(now - last);
            last = now;
            if (block && frames % 5 === 0) {
              const began = performance.now();
              while (performance.now() - began < 100) { /* deliberate offline calibration only */ }
              cpu.push(performance.now() - began);
            }
            if (++frames < 30) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        clearTimeout(timer);
        // Observer delivery is asynchronous. Allow bounded delivery, then drain queued records.
        await new Promise(resolve => setTimeout(resolve, 150));
        result.cases.push({ deliberatelyBlocked: block, frames, insertedBlocks: cpu.length,
          insertedCpuTotalMs: cpu.reduce((a, b) => a + b, 0),
          rafGapsOver50Ms: gaps.filter(gap => gap > 50).length,
          rafGapP50Ms: percentile(gaps, 0.5), rafGapMaxMs: Math.max(...gaps),
          observedIntervalMs: performance.now() - start,
          mainThreadTiming: timing.finish(performance.now()) });
      } finally { clearTimeout(timer); timing.dispose(); }
    }
    result.completed = true;
  } catch (error) { result.completed = false; result.error = String(error.message); }
  document.getElementById('report').textContent = JSON.stringify(result, null, 2);
  button.disabled = false;
});

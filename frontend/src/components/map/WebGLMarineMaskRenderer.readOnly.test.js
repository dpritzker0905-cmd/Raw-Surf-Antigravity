import fs from 'fs';
import path from 'path';
import { renderMaskToCanvas } from './WebGLMarineMaskRenderer';

// READ-ONLY mask canvases (2026-10-23): the coarse-base capture uploads its mask canvas and never paints on it, so it skips the
// 4096 x 2048 drawImage copy the pristine-canvas cache otherwise makes on a hit (36.6 ms in the lead's live trace) and on a miss.
describe('renderMaskToCanvas readOnly', () => {
  let copies;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    copies = 0;
    const noop = () => {};
    HTMLCanvasElement.prototype.getContext = function () {
      return { fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop, save: noop, restore: noop,
        drawImage: () => { copies += 1; }, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {} };
    };
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    delete window.__RAW_DISABLE_MASK_READONLY_CANVAS__;
  });
  const land = () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-100, 20], [-90, 20], [-90, 30], [-100, 30], [-100, 20]]] } }] });
  const WORLD = { west: -180, south: -80, east: 180, north: 84 };

  it('a read-only miss caches the canvas it returns (no copy) and a read-only hit returns that same canvas (no copy)', () => {
    const geo = land();
    const a = renderMaskToCanvas(geo, WORLD, { readOnly: true });
    expect(copies).toBe(0);
    const b = renderMaskToCanvas(geo, WORLD, { readOnly: true });
    expect(b).toBe(a);
    expect(copies).toBe(0);
    const c = renderMaskToCanvas(geo, WORLD);                         // a painting caller still gets its own copy
    expect(c).not.toBe(a);
    expect(copies).toBe(1);
  });

  it('default callers keep the pristine-copy behaviour; the kill switch restores it for read-only callers too', () => {
    const geo = land();
    const a = renderMaskToCanvas(geo, WORLD);                          // miss: one copy into the cache
    expect(copies).toBe(1);
    const b = renderMaskToCanvas(geo, WORLD);                          // hit: one copy out
    expect(b).not.toBe(a);
    expect(copies).toBe(2);
    window.__RAW_DISABLE_MASK_READONLY_CANVAS__ = true;
    const c = renderMaskToCanvas(geo, WORLD, { readOnly: true });
    expect(c).not.toBe(a);
    expect(copies).toBe(3);
  });

  it('wiring: the coarse-base (standalone) mask is the read-only caller, and only it', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineTextureEncoder.js'), 'utf8');
    // One level of nested call allowed: since 2026-10-23 the land passes through waveLakes.withWaveLakes (the carried lakes cut in).
    expect((src.match(/renderMaskToCanvas\((?:[^()]|\([^()]*\))*readOnly: true/g) || []).length).toBe(1);
    expect(src).toMatch(/const maskCanvas = renderMaskToCanvas\(withWaveLakes\(landGeoJSON, waveGrid, bounds\), bounds, \{ readOnly: true \}\);/);
  });
});

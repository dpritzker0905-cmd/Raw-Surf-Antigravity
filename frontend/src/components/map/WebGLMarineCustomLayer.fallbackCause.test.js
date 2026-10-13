/**
 * Why the session fell back to the Canvas2D marine renderer (2026-09-26).
 *
 * Dev E2E run 36285144742 caught the Chrome burst at Sebastian z12 stalling 22,378 ms and 30,456 ms:
 * the layer was not called at all (layerCalls 0), and the churn log showed engine_dispose x2 +
 * foam_mount at the stall's start — `webglMarineFailed` flipped and MapWebGL swapped this engine for
 * `MarineParticleCanvas`, which draws no heatmap, for the rest of the session. Nothing recorded WHAT
 * threw. Each render error and each fallback now lands on the churn log the continuity gate attaches.
 */
import fs from 'fs';
import path from 'path';
import { createCustomLayer } from './WebGLMarineCustomLayer';

const ref = (current) => ({ current });
const log = () => (window.__MARINE_CHURN__ && window.__MARINE_CHURN__.log) || [];

beforeAll(() => {
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});

beforeEach(() => {
  delete window.__MARINE_CHURN__;
  window.__RAW_GPU__ = {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete window.__MARINE_CHURN__;
  delete window.__RAW_GPU__;
  jest.restoreAllMocks();
});

it('records every render error with its message, and the fallback with its cause', () => {
  const engine = { render: jest.fn(() => { throw new Error('texImage2D: size mismatch at z12'); }) };
  const onError = jest.fn();
  const map = {
    getBounds() { throw new Error('no bounds in a unit test'); },
    getCanvas: () => ({ width: 1, height: 1 }),
    getZoom: () => 12,
    triggerRepaint: jest.fn(),
  };
  const layer = createCustomLayer(engine, ref(true), ref(map), ref(null), ref(null), ref(onError),
    ref('dark'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
  const args = { gl: {}, defaultProjectionData: { mainMatrix: new Float32Array(16) } };
  for (let i = 0; i < 3; i++) layer.render(args);

  const errors = log().filter((e) => e.kind === 'marine_render_error');
  expect(errors.map((e) => [e.n, e.message])).toEqual([
    [1, 'texImage2D: size mismatch at z12'], [2, 'texImage2D: size mismatch at z12'],
    [3, 'texImage2D: size mismatch at z12'],
  ]);
  const fallbacks = log().filter((e) => e.kind === 'marine_webgl_fallback');
  expect(fallbacks).toHaveLength(1);
  expect(fallbacks[0].cause).toBe('render_error_burst');
  expect(onError).toHaveBeenCalledTimes(1);
  expect(map.triggerRepaint).toHaveBeenCalledTimes(3);   // the animation clock survives each throw
});

it('the init-failure and context-loss fallbacks name their cause too', () => {
  const layerSrc = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
  expect(layerSrc).toMatch(/recordChurn\('marine_webgl_fallback', \{ cause: 'init_failed'[^\n]*\n\s*if \(onErrorRef\.current\) onErrorRef\.current\(\);/);
  const surfaceSrc = fs.readFileSync(path.join(__dirname, 'useMapErrorSurface.js'), 'utf8');
  expect(surfaceSrc).toMatch(/recordChurn\('marine_webgl_fallback', \{ cause: 'context_lost' \}\);\s*\r?\n\s*setWebglWindFailed\(true\);\s*\r?\n\s*setWebglMarineFailed\(true\);/);
});

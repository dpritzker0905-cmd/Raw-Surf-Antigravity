import WebGLMarineEngine from '../../src/components/map/WebGLMarineEngine';
import { createCustomLayer } from '../../src/components/map/WebGLMarineCustomLayer';

// An isolated draw of the actual engine/layer. Synthetic all-water inputs deliberately remove
// weather evolution and coastal-mask changes from the arrival-timing intervention.
window.runHandoffLab = async ({ delayFrames = 0, height = 2, incomingHeight = 2, blend = false, frameMs = 100,
  visibilityCases = false, legacyDraws = false } = {}) => {
  window.__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__ = blend;
  window.__RAW_DISABLE_ZERO_OPACITY_SKIP__ = legacyDraws;
  let clock = 10000, seed = 12345;
  Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
  Date.now = () => 1788900000000 + clock;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 384; document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error('WebGL unavailable');
  const engine = new WebGLMarineEngine();
  let zoom = 6, box = [-86, 22, -74, 34];
  const map = {
    getBounds: () => ({ getWest: () => box[0], getSouth: () => box[1], getEast: () => box[2], getNorth: () => box[3] }),
    getZoom: () => zoom, isZooming: () => false, isMoving: () => false,
    getCanvas: () => canvas, triggerRepaint: () => {},
    getCenter: () => ({ lng: -80, lat: 28 }),
    getStyle: () => ({ layers: [], sources: {} }), getSource: () => null,
    queryRenderedFeatures: () => [], querySourceFeatures: () => [],
    painter: { context: { gl } },
  };
  window.map = map;
  const ref = current => ({ current });
  let layerErrors = 0;
  const layer = createCustomLayer(engine, ref(true), ref(map), ref(null), ref(gl),
    ref(() => { layerErrors++; }), ref('light'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
  layer.onAdd(map, gl);
  const submissions = { heatmap: 0, crests: 0, advection: 0 };
  if (visibilityCases) {
    // Observe actual submissions, including hidden simulation; never intercept a draw.
    let program = gl.getParameter(gl.CURRENT_PROGRAM);
    const use = gl.useProgram;
    gl.useProgram = function(p) { program = p; return use.call(this, p); };
    for (const name of ['drawElements', 'drawArrays']) {
      const draw = gl[name];
      gl[name] = function(...args) {
        const kind = program === engine.heatmapProgram ? 'heatmap' : program === engine.drawProgram
          ? 'crests' : program === engine.advectProgram ? 'advection' : null;
        if (kind) submissions[kind]++;
        return draw.apply(this, args);
      };
    }
  }
  const grid = (b, cols, rows, h, id) => ({
    bounds: { west: b[0], south: b[1], east: b[2], north: b[3] }, cols, rows,
    __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false,
    __provider: 'synthetic_control', productId: id, validTime: '2026-09-08T00:00:00Z', hourOffset: 0,
    vectors: Array.from({ length: cols * rows }, (_, i) => ({
      lng: b[0] + (i % cols) * (b[2] - b[0]) / (cols - 1),
      lat: b[1] + Math.floor(i / cols) * (b[3] - b[1]) / (rows - 1),
      u: 0, v: -h, speed: h, direction: 0, period: 10, is_valid: true,
    })),
  });
  const coarse = grid([-180, -78, 180, 84], 37, 17, height, 'fixed-global');
  const regional = grid([-88, 20, -72, 36], 17, 17, height, 'fixed-regional');
  const incoming = grid([-100, 10, -56, 46], 45, 37, incomingHeight, 'fixed-incoming');
  const snapshots = [];
  const mercY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  async function draw(phase, frame, scenario) {
    const l = (box[0] + 180) / 360, r = (box[2] + 180) / 360;
    const top = mercY(box[3]), bottom = mercY(box[1]);
    const sx = 2 / (r - l), sy = -2 / (bottom - top);
    const matrix = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0,
      -(r + l) / (r - l), (bottom + top) / (bottom - top), 0, 1]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.82, 0.88, 0.94, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (scenario) engine.render(gl, matrix, canvas.width, canvas.height, zoom, scenario.theme, box, scenario.opacity);
    else layer.render(gl, matrix);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let L = 0, changed = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      L += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      if (Math.abs(pixels[i] - 209) + Math.abs(pixels[i + 1] - 224) + Math.abs(pixels[i + 2] - 240) > 8) changed++;
    }
    const g = window.__RAW_GPU__ || {};
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const pixelSha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    snapshots.push({ phase, frame, t: clock, L: L / (pixels.length / 4), painted: changed,
      pixelSha256,
      resident: engine._waveData?.waveGrid?.productId || null,
      mult: g.opacity?.mult, heatmap: g.opacity?.heatmap, wash: g.washEff,
      bridge: g.coarseBridgeActive, coverage: g.ratingBandFade?.covFrac,
      ease: g.opacityEase, handoff: g.bridgeHandoff, glError: gl.getError(), drawCalls: g.drawCallsPerFrame,
      ...(visibilityCases ? { submissions: { ...submissions }, scenario, ratingActive: g.ratingBand?.active } : {}) });
    clock += frameMs;
  }
  engine.setWaveData(gl, coarse, null);
  await draw('coarse', 0);
  engine.setWaveData(gl, regional, null);
  for (let i = 0; i < Math.ceil(2000 / frameMs); i++) await draw('resident', i);
  zoom = 4.724; box = [-94.37067038714238, 18.66, -65.62932961285763, 37.34];
  for (let i = 0; i < Math.ceil(4000 / frameMs); i++) {
    if (i === delayFrames) engine.setWaveData(gl, incoming, null);
    await draw('handoff', i);
  }
  if (visibilityCases) {
    // Renderer-boundary matrix (separate from the layer lifecycle above). Preserve
    // time-varying rating shaders and opacity-independent debug output in every theme.
    for (const rating of [false, true]) {
      const field = grid([-100, 10, -56, 46], 45, 37, 2, 'visibility-' + rating);
      field.ratingMode = rating;
      if (rating) field.vectors.forEach((v, i) => { v.phys_speed = 2; v.speed = 3 + (i % 19) / 4; });
      window.__SURF_MODE__ = rating;
      engine.setWaveData(gl, field, null);
      for (const theme of ['light', 'dark', 'beach']) for (const debug of ['normal', 'why', 'part_fbo']) {
        window.__GPU_DEBUG__ = { mode: debug };
        for (const [frame, opacity] of [1, 0, 0, 1].entries()) {
          await draw('visibility', frame, { rating, theme, debug, opacity });
        }
      }
    }
  }
  return { delayFrames, height, incomingHeight, frameMs, layerErrors, snapshots,
    ...(visibilityCases ? { legacyDraws, submissions } : {}),
    gpu: gl.getParameter(gl.RENDERER), image: canvas.toDataURL(),
    scope: 'Actual source engine/layer; fixed synthetic all-water fields, fixed clocks/random seed. No app lifecycle or coastal geography validation.' };
};

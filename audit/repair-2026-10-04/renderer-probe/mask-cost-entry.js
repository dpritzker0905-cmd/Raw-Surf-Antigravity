import WebGLMarineEngine from '../../../frontend/src/components/map/WebGLMarineEngine';
const button = document.getElementById('run');
const report = document.getElementById('report');
button.addEventListener('click', () => {
  button.disabled = true;
  const result = { synthetic: true, actualEngineAndCanvas: true, fullLayer: false,
    physicalForecast: false, backendRequests: 0, gpuCompletion: 'unmeasured', cases: [] };
  const original = document.createElement.bind(document);
  try {
    for (const ready of [false, true]) {
      const texture = {};
      const engine = Object.create(WebGLMarineEngine.prototype);
      Object.assign(engine, { _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [] },
        _cachedMaskBounds: { west: 0, east: 4, south: 0, north: 4 },
        _cachedMaskTex: texture, _waveData: { u_oceanMaskTexture: texture } });
      const map = { getZoom: () => 7, getStyle: () => ({ layers: [] }),
        isSourceLoaded: () => ready, areTilesLoaded: () => ready,
        querySourceFeatures: () => [], getBounds: () => ({
          getWest: () => 1, getEast: () => 2, getSouth: () => 1, getNorth: () => 2 }) };
      let canvases = 0;
      document.createElement = (...args) => {
        if (args[0] === 'canvas') canvases++;
        return original(...args);
      };
      const durations = [], outcomes = [], reasons = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        outcomes.push(engine.refreshMaskWithBasemapWater({}, map));
        durations.push(performance.now() - start); reasons.push(engine._lastMaskRepatchReason);
      }
      result.cases.push({ tileReady: ready, waterFeatures: 0, attempts: 10,
        canvasesAllocated: canvases, paintedSuccessfully: outcomes.filter(Boolean).length,
        regionalPatchRecorded: !!engine._regionalPatchState, reasons,
        totalCpuCallMs: +durations.reduce((sum, value) => sum + value, 0).toFixed(3),
        maxCpuCallMs: +Math.max(...durations).toFixed(3) });
      document.createElement = original;
    }
    result.completed = true;
  } catch (error) { result.completed = false; result.error = error.message; }
  finally { document.createElement = original; report.textContent = JSON.stringify(result, null, 2); button.disabled = false; }
});

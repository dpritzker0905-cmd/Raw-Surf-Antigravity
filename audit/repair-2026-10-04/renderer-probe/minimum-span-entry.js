import WebGLMarineEngine from '../../../frontend/src/components/map/WebGLMarineEngine';

// Offline actual engine/painter/Canvas; map geometry and GL are synthetic. No backend or GPU.
document.getElementById('run').addEventListener('click', () => {
  const result = { actualEngineAndCanvas: true, syntheticMapAndGL: true,
    backendRequests: 0, gpuCompletionMeasured: false, cases: [] };
  window.__RAW_DISABLE_SHELTERED_WATER__ = true;
  try {
    for (const basin of [false, true]) {
      for (const canvasCacheDisabled of [false, true]) {
      window.__RAW_DISABLE_MASK_CANVAS_CACHE__ = canvasCacheDisabled;
      let baseline = null, firstBaseline = null;
      for (const disabled of [true, false]) {
        window.__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__ = disabled;
        let uploads = 0, queries = 0, pixels = null, firstPixels = null;
        let bound = null, flip = false;
        const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
          getParameter: key => key === 2 ? bound : flip,
          bindTexture: (_target, value) => { bound = value; },
          pixelStorei: (_target, value) => { flip = value; },
          createTexture: () => ({}), texParameteri() {},
          texImage2D: (...args) => {
            uploads++;
            const canvas = args[5];
            pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            if (!firstPixels) firstPixels = pixels;
          } };
        const engine = Object.create(WebGLMarineEngine.prototype);
        engine._cachedMaskGeoJSON = { type: 'FeatureCollection', features: [{ type: 'Feature',
          properties: {}, geometry: { type: 'Polygon',
            coordinates: [[[0,0],[3,0],[3,3],[0,3],[0,0]]] } }] };
        const size = basin ? 0.05 : 0.005;
        const water = { type: 'Feature', properties: { class: 'ocean' }, geometry: {
          type: 'Polygon', coordinates: [[[1,1],[2,1],[2,2],[1,2],[1,1]]] } };
        const map = { getZoom: () => 13,
          getStyle: () => ({ layers: [{ id: 'water', type: 'fill', source: 'fixture', 'source-layer': 'water' }] }),
          getSource: () => ({}), isSourceLoaded: () => true, areTilesLoaded: () => true,
          queryRenderedFeatures: () => { queries++; return [water]; },
          querySourceFeatures: () => [],
          getBounds: () => ({ getWest: () => 1, getEast: () => 1 + size,
            getSouth: () => 1, getNorth: () => 1 + size }) };
        const outcomes = [];
        for (let attempt = 0; attempt < 3; attempt++)
          outcomes.push(engine.refreshViewportOverlayMask(gl, map, basin));
        let differentBytes = 0, waterPixels = 0, landPixels = 0, repeatedPaintDifferentBytes = 0, firstPaintDifferentBytes = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] >= 128) waterPixels++;
          else landPixels++;
        }
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== firstPixels[i]) repeatedPaintDifferentBytes++;
        if (firstBaseline) {
          for (let i = 0; i < firstPixels.length; i++) if (firstPixels[i] !== firstBaseline[i]) firstPaintDifferentBytes++;
        } else firstBaseline = firstPixels;
        if (baseline) {
          if (!pixels || pixels.length !== baseline.length) throw new Error('Pixel dimensions changed');
          for (let i = 0; i < pixels.length; i++) if (pixels[i] !== baseline[i]) differentBytes++;
        } else baseline = pixels;
        result.cases.push({ basin, canvasCacheDisabled, rollbackEnabled: disabled, attempts: 3, outcomes, uploads, queries,
          degraded: engine._overlayPaintDegraded, textureSpan: engine._overlayMaskBounds.east - engine._overlayMaskBounds.west,
          dimensions: engine._overlayMaskTexDims, comparedBytes: disabled ? 0 : pixels.length,
          differentBytes, firstPaintDifferentBytes, repeatedPaintDifferentBytes,
          waterPixels, landPixels, glStateRestored: bound === null && flip === false });
      }
      }
    }
    delete window.__RAW_DISABLE_MASK_CANVAS_CACHE__;
    delete window.__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__;
    result.regionalRetention = [];
    for (const zoom of [8, 10, 11.999, 12]) {
      let baseline = null;
      for (const rollback of [true, false]) {
        window.__RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__ = rollback;
        let bound = null, flip = false, uploads = 0, overlayUploads = 0, queries = 0, pixels = null;
        const resident = {};
        const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
          getParameter: key => key === 2 ? bound : flip,
          bindTexture: (_target, value) => { bound = value; },
          pixelStorei: (_target, value) => { flip = value; },
          createTexture: () => ({}), texParameteri() {}, texImage2D: (...args) => {
            uploads++;
            if (bound !== resident) {
              overlayUploads++;
              const canvas = args[5];
              pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            }
          } };
        const engine = Object.create(WebGLMarineEngine.prototype);
        Object.assign(engine, { _cachedMaskTex: resident, _waveData: { u_oceanMaskTexture: resident },
          _cachedMaskBounds: { west: 0, east: 4, south: 0, north: 4 },
          _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
            geometry: { type: 'Polygon', coordinates: [[[0,0],[1.5,0],[1.5,3],[0,3],[0,0]]] } }] } });
        const water = { type: 'Feature', properties: { class: 'ocean' }, geometry: {
          type: 'Polygon', coordinates: [[[1.5,1],[2,1],[2,2],[1.5,2],[1.5,1]]] } };
        const map = { getZoom: () => zoom,
          getStyle: () => ({ layers: [{ id: 'water', type: 'fill', source: 'fixture', 'source-layer': 'water' }] }),
          getSource: () => ({}), isSourceLoaded: () => true, areTilesLoaded: () => true,
          queryRenderedFeatures: () => { queries++; return [water]; }, querySourceFeatures: () => [],
          getBounds: () => ({ getWest: () => 1, getEast: () => 2, getSouth: () => 1, getNorth: () => 2 }) };
        const outcomes = [];
        for (let i = 0; i < 3; i++) outcomes.push(engine.refreshMaskWithBasemapWater(gl, map));
        let differentBytes = 0;
        if (baseline) {
          if (!pixels || pixels.length !== baseline.length) throw new Error('Regional pixel dimensions changed');
          for (let i = 0; i < pixels.length; i++) if (pixels[i] !== baseline[i]) differentBytes++;
        } else baseline = pixels;
        let waterPixels = 0, landPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] >= 128) waterPixels++; else landPixels++;
        }
        result.regionalRetention.push({ zoom, rollback, attempts: 3, outcomes, uploads, overlayUploads, queries,
          degraded: engine._overlayPaintDegraded, comparedBytes: rollback ? 0 : pixels.length,
          differentBytes, waterPixels, landPixels, glStateRestored: bound === null && flip === false });
      }
    }
    result.completed = result.cases.every(row => row.uploads === (row.rollbackEnabled ? 3 : 1)
      && row.queries === row.uploads && row.degraded === false && row.glStateRestored
      && row.waterPixels > 0 && row.landPixels > 0 && row.differentBytes === 0
      && row.firstPaintDifferentBytes === 0 && row.repeatedPaintDifferentBytes === 0)
      && result.regionalRetention.every(row => row.uploads === (row.rollback && row.zoom < 12 ? 4 : 2)
        && row.overlayUploads === row.uploads - 1 && row.queries === row.uploads
        && row.degraded === false && row.differentBytes === 0 && row.glStateRestored
        && row.waterPixels > 0 && row.landPixels > 0);
  } catch (error) { result.completed = false; result.error = error.message; }
  finally {
    delete window.__RAW_DISABLE_SHELTERED_WATER__;
    delete window.__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__;
    delete window.__RAW_DISABLE_MASK_CANVAS_CACHE__;
    delete window.__RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__;
  }
  document.getElementById('report').textContent = JSON.stringify(result, null, 2);
});

// TEMPORARY LOCAL AUDIT OBSERVER. Remove the public copy and index tag before committing.
// Observes weather diagnostics only; does not alter map, forecast, or account state.
(() => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  let frames = 0;
  const blocked = [];
  const scenario = new URLSearchParams(location.search).get('audit14');
  if (/^wp3-block-z(3|7|9)$/.test(scenario || '')) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const bbox = (url.searchParams.get('bbox') || '').split(',').map(Number);
      if (/\/api\/weather\/grid(_series)?$/.test(url.pathname) && url.searchParams.get('domain') === 'marine'
          && bbox.length === 4 && bbox[2] - bbox[0] >= 350) {
        blocked.push({at: new Date().toISOString(), url: url.toString()});
        return Promise.reject(new TypeError('Audit14 D3: world marine request disabled'));
      }
      return originalFetch(input, init);
    };
  }
  const start = performance.now();
  const tick = () => { frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const output = document.createElement('script');
  output.type = 'application/json'; output.id = 'audit14-observation';
  document.body.appendChild(output);
  // Audit WP2 explicitly specifies programmatic positioning; never active in WP1.
  let positioned = false;
  setInterval(() => {
    const map = window.map || window.__MAP_INSTANCE__;
    if (!positioned && location.search === '?audit14=wp2-z8' && map?.isStyleLoaded()) {
      positioned = true;
      map.jumpTo({center: [-80.45, 27.86], zoom: 8});
    }
    if (!positioned && /^wp3-block-z(3|7|9)$/.test(scenario || '') && map?.isStyleLoaded()) {
      positioned = true;
      map.jumpTo({center: [-80.45, 27.86], zoom: Number(scenario.slice(-1))});
    }
    const timeline = document.querySelector('[aria-label="Forecast timeline wheel"]');
    const accepted = window.__MARINE_ENGINE__?._waveData?.waveGrid;
    const frameIdentity = grid => grid ? Object.fromEntries(['hourOffset', 'valid_time', 'served_valid_time', 'validTime', '__sourceModel', '__componentLayer', 'cols', 'rows', 'model_run_time', 'run_time', 'runTime', 'productId'].map(key => [key, grid[key] ?? null])) : null;
    output.textContent = JSON.stringify({
      at: new Date().toISOString(), elapsedMs: performance.now() - start,
      animationFrames: frames, visible: document.visibilityState, focused: document.hasFocus(),
      blockedWorldRequests: blocked.slice(-20),
      viewport: map ? { zoom: map.getZoom(), bbox: map.getBounds().toArray() } : null,
      wheel: timeline ? { value: timeline.getAttribute('aria-valuenow'), text: timeline.getAttribute('aria-valuetext') } : null,
      coverage: window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || null,
      fetch: window.__MARINE_FETCH_DIAG__ || null,
      heatmap: window.__MARINE_HEATMAP_STATUS__ || null,
      pipeline: window.__MARINE_PIPELINE_TRUTH__ || null,
      scrub: window.__MARINE_SCRUB_DIAG__ || null,
      renderHour: window.__MARINE_RENDER_HOUR_PARITY__ || null,
      pending: window.__MARINE_FETCH_PENDING__ || null,
      debouncing: window.__MARINE_FETCH_DEBOUNCING__ || null,
      scrubbing: window.isScrubbingTimeline || false,
      backend: window.__BACKEND_WEATHER_SERVICE_DIAG__ || null,
      projection: window.__MARINE_PROJECTION_DIAG__ || null,
      accepted: frameIdentity(accepted),
      acceptedKeys: Object.keys(accepted || {}),
      acceptedTruthTag: accepted?.truthTag || null,
      coarse: frameIdentity(window.__MARINE_ENGINE__?._coarseBaseData?.waveGrid),
      events: (window.__RAW_FORENSIC__?.events || []).filter(e => ['commit','reject','clear'].includes(e.type)).slice(-5),
      requests: performance.getEntriesByType('resource').filter(e => /\/weather\/(marine\/)?grid/.test(e.name)).slice(-40).map(e => ({ url: e.name, start: e.startTime, duration: e.duration, transferBytes: e.transferSize, encodedBytes: e.encodedBodySize })),
    });
  }, 500);
})();

// Guaranteed early app bootstrap global fetch interceptor for raw proxy diagnostics
if (typeof window !== 'undefined' && !window.__RAW_SURF_PROXY_PATCHED__) {
  window.__RAW_SURF_PROXY_PATCHED__ = true;
  window.__RAW_SURF_PROXY_LEDGER__ = [];

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (url.includes('/api/weather-proxy')) {
      const timestamp = new Date().toISOString();
      const startTime = Date.now();
      let type = 'unknown';
      let source = 'direct_fetch';
      let bodyData = null;
      let model = 'unknown';
      let layer = 'none';

      // Parse details if POST
      if (init && init.method === 'POST' && init.body) {
        try {
          const parsed = JSON.parse(init.body);
          type = parsed.type || 'unknown';
          bodyData = parsed.body || null;
          if (bodyData) {
            model = (bodyData.models && bodyData.models[0]) || 'unknown';
            if (bodyData.hourly) {
              layer = Array.isArray(bodyData.hourly) ? bodyData.hourly.join(',') : bodyData.hourly;
            }
          }
        } catch (e) {}
      } else {
        // Parse GET
        try {
          const searchParams = new URL(url, window.location.origin).searchParams;
          type = searchParams.get('type') || 'unknown';
          model = searchParams.get('models') || 'unknown';
          layer = searchParams.get('hourly') || 'none';
        } catch (e) {}
      }

      // Stack trace source lookup
      let stackTrace = '';
      try {
        stackTrace = new Error().stack || '';
        if (stackTrace) {
          if (stackTrace.includes('fetchExactMarinePoint')) source = 'forecastSamplers.fetchExactMarinePoint';
          else if (stackTrace.includes('fetchMarineData')) source = 'marineController.fetchMarineData';
          else if (stackTrace.includes('fetchCopernicusComponentGrid')) source = 'copernicusGridFetcher.fetchCopernicusComponentGrid';
          else if (stackTrace.includes('useOpenMeteoForecast')) source = 'useOpenMeteoForecast';
          else if (stackTrace.includes('fetchPressureData')) source = 'marineControllerPressure.fetchPressureData';
        }
      } catch (e) {}

      const entry = {
        timestamp,
        method: init?.method || 'GET',
        url,
        type,
        model,
        layer,
        'layer/hourly vars': layer,
        source,
        status: 'pending',
        decision: 'allowed',
        provider: (type.includes('copernicus') || url.includes('copernicus')) ? 'copernicus' : 'open-meteo',
        pointCount: bodyData?.latitude ? (Array.isArray(bodyData.latitude) ? bodyData.latitude.length : 1) : 1,
        'point count': bodyData?.latitude ? (Array.isArray(bodyData.latitude) ? bodyData.latitude.length : 1) : 1,
        elapsedTime: 0,
        'elapsed time': 0,
        stack: stackTrace,
        'stack/caller': stackTrace
      };

      window.__RAW_SURF_PROXY_LEDGER__.push(entry);
      if (window.__RAW_SURF_PROXY_LEDGER__.length > 50) {
        window.__RAW_SURF_PROXY_LEDGER__.shift();
      }

      try {
        const response = await originalFetch.apply(this, arguments);
        const elapsed = Date.now() - startTime;
        entry.elapsedTime = elapsed;
        entry['elapsed time'] = elapsed;
        entry.status = response.status;
        if (response.status === 429) {
          entry.decision = 'rate_limited_response';
        } else if (!response.ok) {
          entry.decision = 'error_response';
        } else {
          entry.decision = 'success';
        }
        return response;
      } catch (err) {
        const elapsed = Date.now() - startTime;
        entry.elapsedTime = elapsed;
        entry['elapsed time'] = elapsed;
        entry.status = 'exception';
        entry.decision = 'exception_thrown';
        throw err;
      }
    }

    return originalFetch.apply(this, arguments);
  };
}

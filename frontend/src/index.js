import './bootstrap';
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Initialize i18n before rendering
import './i18n';
import reportWebVitals, { logWebVitals } from './reportWebVitals';

// Aggressively suppress ResizeObserver errors - these are benign browser warnings
// that React's dev overlay incorrectly shows as errors
if (typeof window !== 'undefined') {
  // Global fetch proxy for legacy weather quarantine
  // NOTE: index.js acts as the OUTER fetch wrapper, while bootstrap.js acts as the INNER wrapper.
  // Because bootstrap.js is imported first (line 1), it overrides window.fetch first.
  // Then, index.js overrides window.fetch, wrapping bootstrap.js's implementation.
  // This execution order ensures that the quarantine logic in index.js intercepts and blocks 
  // direct legacy fetches (returning 403) BEFORE bootstrap.js logs them in its ledger.
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    let urlString = '';
    let method = 'GET';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.toString();
    } else if (input && typeof input === 'object' && input.url) {
      urlString = input.url;
      method = input.method || 'GET';
    }
    if (init && init.method) {
      method = init.method;
    }

    let isTarget = false;
    let block = false;
    const reason = "Direct Open-Meteo or weather-proxy JSON forecast fetch is quarantined in production in favor of backend-owned routes.";

    const isMarineOM = urlString.includes('marine-api.open-meteo.com');
    const isForecastOM = urlString.includes('api.open-meteo.com') && !urlString.includes('map-tiles.open-meteo.com');
    const isWeatherProxy = (urlString.includes('/api/weather-proxy') || urlString.endsWith('weather-proxy')) && !urlString.includes('/api/weather/');

    if (isMarineOM || isForecastOM || isWeatherProxy) {
      isTarget = true;
    }

    if (isTarget) {
      const isProd = process.env.NODE_ENV === 'production';
      const forceQuarantine = window.__WEATHER_FORCE_QUARANTINE__ === true;
      if (isProd || forceQuarantine) {
        block = true;
      }

      let model = 'unknown';
      let layer = 'unknown';
      let backendReplacementUrl = '';

      try {
        const urlObj = new URL(urlString, window.location.origin);
        const searchParams = urlObj.searchParams;
        let qModel = searchParams.get('model') || searchParams.get('models') || '';
        let qHourly = searchParams.get('hourly') || searchParams.get('daily') || '';
        let qType = searchParams.get('type') || '';

        if (qModel) model = qModel;
        if (qType) layer = qType;
        else if (qHourly) layer = qHourly;

        if (init && init.body && typeof init.body === 'string') {
          const bodyObj = JSON.parse(init.body);
          if (bodyObj.type) {
            layer = bodyObj.type;
          }
          if (bodyObj.body && bodyObj.body.models) {
            model = Array.isArray(bodyObj.body.models) ? bodyObj.body.models.join(',') : bodyObj.body.models;
          } else if (bodyObj.models) {
            model = Array.isArray(bodyObj.models) ? bodyObj.models.join(',') : bodyObj.models;
          }
        }
      } catch (e) {}

      const cleanModel = model.toUpperCase().includes('GFS') ? 'GFS' : (model.toUpperCase().includes('ICON') ? 'ICON' : 'EURO');
      let domain = 'weather';
      let cleanLayer = 'wind';
      
      const layerLower = layer.toLowerCase();
      if (layerLower.includes('wave') || layerLower.includes('swell')) {
        domain = 'marine';
        if (layerLower.includes('swell_1') || layerLower.includes('swell_wave_height') || layerLower.includes('swell_wave_direction') || layerLower.includes('swell_wave_period')) cleanLayer = 'swell_1';
        else if (layerLower.includes('swell_2') || layerLower.includes('secondary_swell')) cleanLayer = 'swell_2';
        else if (layerLower.includes('wind_wave')) cleanLayer = 'wind_waves';
        else cleanLayer = 'waves';
      } else if (layerLower.includes('pressure')) {
        cleanLayer = 'pressure';
      } else if (layerLower.includes('precip')) {
        cleanLayer = 'precipitation';
      } else {
        cleanLayer = 'wind';
        domain = 'wind';
      }

      backendReplacementUrl = `/api/weather/point?model=${cleanModel}&domain=${domain}&layer=${cleanLayer}`;

      let activeLegacyModule = 'unknown';
      let stackTrace = '';
      try {
        stackTrace = new Error().stack || '';
        if (stackTrace) {
          if (stackTrace.includes('fetchExactMarinePoint')) activeLegacyModule = 'forecastSamplers.fetchExactMarinePoint';
          else if (stackTrace.includes('fetchMarineData')) activeLegacyModule = 'marineController';
          else if (stackTrace.includes('fetchCopernicusComponentGrid')) activeLegacyModule = 'copernicusGridFetcher';
          else if (stackTrace.includes('useOpenMeteoForecast')) activeLegacyModule = 'useOpenMeteoForecast';
          else if (stackTrace.includes('fetchPressureData')) activeLegacyModule = 'marineControllerPressure';
          else if (stackTrace.includes('fetchWindData')) activeLegacyModule = 'windController';
        }
      } catch (e) {}

      let actionRequired = 'delete';
      if (activeLegacyModule === 'useOpenMeteoForecast') {
        actionRequired = 'migrate';
      } else if (isWeatherProxy) {
        actionRequired = 'keep as gated rollback';
      }

      window.__WEATHER_FRONTEND_LEGACY_AUDIT__ = {
        activeLegacyModule: activeLegacyModule,
        attemptedUrl: urlString,
        blocked: block,
        productionReachable: true,
        backendReplacementRoute: backendReplacementUrl,
        actionRequired: actionRequired,
        timestamp: new Date().toISOString()
      };

      window.__WEATHER_LEGACY_QUARANTINE_DIAG__ = {
        attemptedLegacyPath: urlString,
        url: urlString,
        method: method,
        blockedInProduction: block,
        forcedByDebugFlag: forceQuarantine,
        backendReplacementUrl: backendReplacementUrl,
        reason: reason,
        timestamp: new Date().toISOString()
      };

      if (block) {
        console.warn(`[Weather Quarantine] Blocked direct JSON forecast fetch: ${urlString}`);
        return new Response(JSON.stringify({
          error: "Blocked by weather legacy quarantine",
          code: "QUARANTINE_BLOCKED",
          diagnostics: window.__WEATHER_LEGACY_QUARANTINE_DIAG__
        }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // Override error handler
  const originalError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    if (message && message.toString().includes('ResizeObserver')) {
      return true;
    }
    // Suppress AbortErrors from @openmeteo/weather-map-layer source cleanup
    if (error?.name === 'AbortError' || error?.name === 'DOMException' ||
        (message && (message.toString().includes('aborted') || message.toString().includes('AbortError')))) {
      return true;
    }
    if (originalError) {
      return originalError(message, source, lineno, colno, error);
    }
    return false;
  };

  // Suppress in event listener (capture phase to catch before React's dev overlay)
  window.addEventListener('error', function(e) {
    if (e.message && e.message.includes('ResizeObserver')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      return true;
    }
    // Suppress AbortErrors from map layer cleanup
    if (e.error?.name === 'AbortError' || e.error?.name === 'DOMException' ||
        (e.message && (e.message.includes('aborted') || e.message.includes('AbortError')))) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      return true;
    }
  }, true);

  // Suppress unhandled AbortError promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    if (e.reason?.name === 'AbortError' || e.reason?.name === 'DOMException' ||
        (e.reason?.message && (e.reason.message.includes('aborted') || e.reason.message.includes('AbortError')))) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // v86.4: Auto-dismiss CRA error overlay when it only contains AbortErrors.
  if (process.env.NODE_ENV === 'development') {
    const dismissAbortOverlay = () => {
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            const text = doc.body?.textContent || '';
            if ((text.includes('AbortError') || text.includes('signal is aborted') || 
                 text.includes('user aborted')) && 
                !text.includes('SyntaxError') && !text.includes('TypeError') &&
                !text.includes('ReferenceError')) {
              iframe.style.display = 'none';
              iframe.remove();
            }
          }
        } catch (e) { /* cross-origin iframe */ }
      });
    };
    const overlayObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeName === 'IFRAME' || (node.nodeType === 1 && node.querySelector?.('iframe'))) {
            setTimeout(dismissAbortOverlay, 150);
            setTimeout(dismissAbortOverlay, 500);
          }
        }
      }
    });
    const startObserving = () => {
      if (document.body) {
        overlayObserver.observe(document.body, { childList: true, subtree: true });
      } else {
        setTimeout(startObserving, 50);
      }
    };
    startObserving();
  }

  // Also patch ResizeObserver to not throw
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO {
    constructor(callback) {
      super((entries, observer) => {
        requestAnimationFrame(() => {
          try {
            callback(entries, observer);
          } catch (e) {
            // Suppress
          }
        });
      });
    }
  };

  // Global broken-image fallback handler
  // Catches ALL failed <img> loads and prevents the broken-image icon.
  // For avatar images (with class "rounded-full"), replaces with an initial letter.
  // For other images, hides them gracefully.
  document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG') {
      const img = e.target;
      // Prevent infinite re-trigger
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = 'true';

      const isAvatar = img.className?.includes('rounded-full');
      if (isAvatar) {
        // Replace with initial-letter div
        const initial = (img.alt || '?').charAt(0).toUpperCase();
        const fallback = document.createElement('div');
        fallback.className = img.className;
        fallback.style.cssText = `
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #8b5cf6, #06b6d4);
          color: white; font-weight: 700; user-select: none;
        `;
        fallback.textContent = initial;
        fallback.setAttribute('role', 'img');
        fallback.setAttribute('aria-label', img.alt || 'Avatar');
        if (img.parentNode) img.parentNode.replaceChild(fallback, img);
      } else {
        // Hide non-avatar broken images
        img.style.display = 'none';
      }
    }
  }, true); // capture phase to catch before React
}

// Loading fallback for translations
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-black">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
  </div>
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <Suspense fallback={<LoadingFallback />}>
      <App />
    </Suspense>
);

// --- Service Worker Registration ---
// Enables offline caching, push notifications, and PWA installability.
if ('serviceWorker' in navigator) {
  // DEV GUARD: NEVER run the service worker on localhost. A resident SW (skipWaiting + clients.claim, hourly
  // update check) silently pins an old build and serves stale JS across reloads — which repeatedly masked freshly
  // built code during debugging (a whole marine-render session was lost to it). On localhost we instead UNREGISTER
  // any existing SW and purge its rawsurf-* caches so `npm start` always serves exactly what you just compiled.
  const _host = window.location.hostname;
  const _isLocalhost = _host === 'localhost' || _host === '127.0.0.1' || _host === '0.0.0.0' || _host === '[::1]';
  if (_isLocalhost) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (window.caches && caches.keys) {
      caches.keys()
        .then((keys) => keys.forEach((k) => { if (k.startsWith('rawsurf-')) caches.delete(k).catch(() => {}); }))
        .catch(() => {});
    }
    console.log('[SW] Localhost — service worker unregistered + caches purged (dev always serves fresh code).');
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then((registration) => {
          // Check for updates every 60 minutes
          setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000);
        })
        .catch((error) => {
          console.warn('[SW] Registration failed:', error);
        });
    });
  }
}

// --- Core Web Vitals Monitoring ---
// Reports LCP, FID, CLS, TTFB, INP metrics. Logs in dev, ready for analytics.
reportWebVitals(logWebVitals);

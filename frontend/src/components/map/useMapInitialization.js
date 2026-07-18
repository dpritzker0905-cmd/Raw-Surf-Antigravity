import { useState, useEffect } from 'react';
import { markMapReady } from '../../engine/init-sequencer';

export function useMapInitialization({ innerMapRef, mapInstanceRef }) {
  const [mapInstance, setMapInstance] = useState(null);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current) {
      if (mapInstanceRef) mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  // Window-level AbortError suppression
  useEffect(() => {
    const errorHandler = (event) => {
      if (event.error?.name === 'AbortError' || 
          (event.message && event.message.includes('aborted'))) {
        event.preventDefault();
        return true;
      }
    };
    const rejectionHandler = (event) => {
      if (event.reason?.name === 'AbortError' || 
          (event.reason?.message && event.reason.message.includes('aborted'))) {
        event.preventDefault();
      }
    };
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);
    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };
  }, []);

  // MapLibre instance-level source and addSource patching
  useEffect(() => {
    const map = innerMapRef.current?.getMap?.();
    if (map && !mapInstance) {
      setMapInstance(map);
      window.map = map;

      // DPR SYNC (2026-07-18, the "oversized/blurry wave animations" root): MapLibre samples
      // devicePixelRatio ONCE at construction. When the window's DPR changes after mount (moved
      // between monitors, browser/system zoom, the embedded preview pane), the canvas backing
      // store stays at the OLD ratio — live-proven: dpr 2 with canvas 1177×910 == its CSS size
      // (half-res, compositor-upscaled 2× ⇒ every crest drawn double-size and soft; ×2354 sharp
      // after setPixelRatio+resize). Sync now (heals a stale-at-mount ratio) and re-sync on every
      // DPR change via the standard matchMedia re-arm loop. Kill: __RAW_DISABLE_DPR_SYNC__.
      if (typeof window !== 'undefined' && window.__RAW_DISABLE_DPR_SYNC__ !== true &&
          typeof map.setPixelRatio === 'function') {
        const syncDpr = () => {
          try {
            const want = window.devicePixelRatio || 1;
            // Compare the CANVAS BACKING ratio, not map.getPixelRatio(): the getter reads
            // devicePixelRatio LIVE (always "correct"), while the canvas keeps the ratio it was
            // last SIZED at — live-proven: getPixelRatio 2, painter 1, canvas 1177==CSS at dpr 2.
            const cv = map.getCanvas();
            const have = cv && cv.clientWidth > 0 ? cv.width / cv.clientWidth : null;
            if (have !== null && Math.abs(have - want) > 0.05) {
              map.setPixelRatio(want);   // pins the override so _resizeCanvas uses it
              map.resize();
              if (window.__RAW_GPU__) window.__RAW_GPU__.dprSync = { at: Date.now(), from: +have.toFixed(2), to: want };
            }
          } catch (e) { /* best-effort — never break map init */ }
        };
        let dprMql = null;
        const armDprWatch = () => {
          try {
            if (dprMql) dprMql.onchange = null;
            dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            dprMql.onchange = () => { syncDpr(); armDprWatch(); };
          } catch (e) { /* matchMedia unavailable — the mount-time sync still ran */ }
        };
        syncDpr();
        armDprWatch();
        // The boot desync needed no DPR *change* (stale from the initial size pass) — re-verify
        // the invariant after every maplibre resize too. Loop-safe: once the backing ratio
        // matches, syncDpr no-ops.
        try { map.on('resize', syncDpr); } catch (e) { /* ignore */ }
        try { map.once('remove', () => { if (dprMql) dprMql.onchange = null; try { map.off('resize', syncDpr); } catch (e2) {} }); } catch (e) { /* ignore */ }
      }

      // Suppress async AbortErrors
      map.on('error', (e) => {
        if (e?.error?.name === 'AbortError' || e?.error?.message?.includes('aborted')) {
          return;
        }
        console.error('[MapLibre Error]', e?.error || e);
      });

      // Intercept addSource to wrap onRemove with error handling
      const origAddSource = map.addSource.bind(map);
      map.addSource = function(id, sourceSpec) {
        const result = origAddSource.call(this, id, sourceSpec);
        try {
          const src = this.getSource(id);
          if (src && src.onRemove && !src.__abortPatched) {
            src.__abortPatched = true;
            const origOnRemove = src.onRemove.bind(src);
            src.onRemove = function(...args) {
              try {
                return origOnRemove(...args);
              } catch (e) {
                if (e.name === 'AbortError' || e.name === 'DOMException' ||
                    e.message?.includes('aborted' || e.message?.includes('abort'))) {
                  return; // Suppress
                }
                throw e;
              }
            };
          }
        } catch (e) {}
        return result;
      };

      // Re-patch on style load (style may not exist at init time)
      map.on('style.load', () => {
        try {
          const style = map.getStyle();
          if (style?.sources) {
            Object.keys(style.sources).forEach(srcId => {
              const src = map.getSource(srcId);
              if (src && src.onRemove && !src.__abortPatched) {
                src.__abortPatched = true;
                const origOnRemove = src.onRemove.bind(src);
                src.onRemove = function(...args) {
                  try { return origOnRemove(...args); }
                  catch (e) {
                    if (e.name === 'AbortError' || e.name === 'DOMException' ||
                        e.message?.includes('aborted')) return;
                    throw e;
                  }
                };
              }
            });
          }
        } catch (e) {}
      });

      markMapReady(); // Init sequencer: map is ready
      if (typeof window !== 'undefined') {
        window.__MAP_BOOTSTRAPPED__ = true;
      }
      setTimeout(() => {
        try { map.triggerRepaint(); } catch(e) {}
      }, 300);
    }
  });

  return { mapInstance, setMapInstance };
}

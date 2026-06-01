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

import { useEffect, useRef } from 'react';
import { getWindHourlyCache, getMarineHourlyCache, getPressureHourlyCache } from './marineController';

// Check if viewport bounds are fully contained within the cached dataset bounds
function isContained(viewport, cached) {
  if (!viewport || !cached) return false;
  let vWest = viewport.west;
  let vEast = viewport.east;
  if (vEast < vWest) vEast += 360;

  let cWest = cached.west;
  let cEast = cached.east;
  if (cEast < cWest) cEast += 360;

  const vSouth = Math.max(cached.south, Math.min(cached.north, viewport.south));
  const vNorth = Math.max(cached.south, Math.min(cached.north, viewport.north));

  return vSouth >= cached.south && vNorth <= cached.north && vWest >= cWest && vEast <= cEast;
}

export function useMapObservability({ mapInstance, activeLayers, lowSystems = [], highSystems = [], activeSystemPopup }) {
  const lastLoggedTimestampRef = useRef(0);

  useEffect(() => {
    if (!mapInstance) return;

    const handleObserve = () => {
      const now = Date.now();
      // Rate-limit console logs to prevent flooding (max once every 1.5 seconds)
      if (now - lastLoggedTimestampRef.current < 1500) {
        return;
      }
      lastLoggedTimestampRef.current = now;

      try {
        const b = mapInstance.getBounds();
        const vBounds = {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth()
        };

        const zoom = mapInstance.getZoom();
        const proj = mapInstance.getProjection()?.name || 'mercator';

        // 1. [MapCore] Viewport Bounds & Zoom
        console.log(`[MapCore] Viewport Bounds: west=${vBounds.west.toFixed(4)}, south=${vBounds.south.toFixed(4)}, east=${vBounds.east.toFixed(4)}, north=${vBounds.north.toFixed(4)}, zoom=${zoom.toFixed(2)}`);

        // 2. [Projection] Active projection mode
        console.log(`[Projection] Active projection mode: ${proj}`);

        // 3. [Pressure] Dataset Bounds
        const pCache = getPressureHourlyCache();
        if (pCache && pCache.bounds) {
          console.log(`[Pressure] Dataset bounds: west=${pCache.bounds.west}, south=${pCache.bounds.south}, east=${pCache.bounds.east}, north=${pCache.bounds.north}, points=${pCache.points?.length || 0}`);
        } else {
          console.log(`[Pressure] Dataset bounds: null`);
        }

        // 4. [WindOverlay] Dataset Bounds
        const wCache = getWindHourlyCache();
        if (wCache && wCache.bounds) {
          console.log(`[WindOverlay] Dataset bounds: west=${wCache.bounds.west}, south=${wCache.bounds.south}, east=${wCache.bounds.east}, north=${wCache.bounds.north}, points=${wCache.points?.length || 0}`);
        } else {
          console.log(`[WindOverlay] Dataset bounds: null`);
        }

        // 5. [Marine] Dataset Bounds
        const mCache = getMarineHourlyCache();
        if (mCache && mCache.bounds) {
          console.log(`[Marine] Dataset bounds: west=${mCache.bounds.west}, south=${mCache.bounds.south}, east=${mCache.bounds.east}, north=${mCache.bounds.north}, points=${mCache.points?.length || 0}`);
        } else {
          console.log(`[Marine] Dataset bounds: null`);
        }

        // 6. [PopupSystem] Projection Anchors, Clipping, & Fallback Modes
        const systems = [...lowSystems, ...highSystems];

        if (activeSystemPopup) {
          const pixel = mapInstance.project([activeSystemPopup.lng, activeSystemPopup.lat]);
          console.log(`[PopupSystem] Active Popup Anchor: [${activeSystemPopup.lat.toFixed(4)}, ${activeSystemPopup.lng.toFixed(4)}] -> Screen Pixel: x=${pixel?.x?.toFixed(1)}, y=${pixel?.y?.toFixed(1)}`);
          
          if (!b.contains([activeSystemPopup.lng, activeSystemPopup.lat])) {
            console.log(`[PopupSystem] Clipping active system popup at [${activeSystemPopup.lat.toFixed(4)}, ${activeSystemPopup.lng.toFixed(4)}] (outside viewport)`);
          }
        }

        systems.forEach((sys, i) => {
          const pixel = mapInstance.project([sys.lng, sys.lat]);
          console.log(`[PopupSystem] ${sys.type} Marker ${i} Anchor: [${sys.lat.toFixed(4)}, ${sys.lng.toFixed(4)}] -> Screen Pixel: x=${pixel?.x?.toFixed(1)}, y=${pixel?.y?.toFixed(1)}`);
          
          if (!b.contains([sys.lng, sys.lat])) {
            console.log(`[PopupSystem] Clipping marker ${i} at [${sys.lat.toFixed(4)}, ${sys.lng.toFixed(4)}] (outside viewport)`);
          }
        });

        if (window.isScrubbingTimeline === true) {
          console.log(`[PopupSystem] Fallback rendering mode: Timeline scrubbing cache-preservation active`);
        }

        // 7. [Failsafe Clipping Detection]
        const wBounds = wCache?.bounds;
        const pBounds = pCache?.bounds;
        const mBounds = mCache?.bounds;

        const isWindMismatch = wBounds && !isContained(vBounds, wBounds);
        const isPressureMismatch = pBounds && !isContained(vBounds, pBounds);
        const isMarineMismatch = mBounds && !isContained(vBounds, mBounds);
        const hasBoundsMismatch = isWindMismatch || isPressureMismatch || isMarineMismatch;

        const outsideNARegionCount = systems.filter(s => s.lng < -130 || s.lng > -60).length;

        let hasFailingProjection = false;
        systems.forEach(s => {
          const pixel = mapInstance.project([s.lng, s.lat]);
          if (!pixel || isNaN(pixel.x) || isNaN(pixel.y)) {
            hasFailingProjection = true;
          }
        });

        if (hasBoundsMismatch || outsideNARegionCount > 0 || hasFailingProjection) {
          console.warn(`[PopupSystem][WARN] clipping detected - falling back to global projection mode`);
        }

      } catch (err) {
        console.error('[useMapObservability] Observability check threw:', err);
      }
    };

    mapInstance.on('render', handleObserve);
    mapInstance.on('moveend', handleObserve);
    handleObserve();

    return () => {
      mapInstance.off('render', handleObserve);
      mapInstance.off('moveend', handleObserve);
    };
  }, [mapInstance, activeLayers, lowSystems, highSystems, activeSystemPopup]);
}

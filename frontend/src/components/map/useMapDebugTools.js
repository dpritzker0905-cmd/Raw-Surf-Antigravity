import { useEffect, useRef } from 'react';
import { getDispatcherDiagnostics } from '../../engine/RenderPlanDispatcher';
import { getSimDiagnostics } from '../../engine/SimulationLoop';

/**
 * Publish a debug global as a LIVE ACCESSOR instead of a snapshot value.
 *
 * ⛔ WHY (2026-08-09). These were plain assignments of React props inside the effect below, and the
 * effect had been deliberately decoupled from per-frame updates for performance (see the note at its
 * top). That perf win silently froze the published diagnostics: measured, `window.__SIM_DIAGNOSTICS__`
 * lagged the live engine by 1,414 frames (~23.6 s) and reported a healthy 60 Hz loop as STALLED —
 * `frameIndex` delta 0 over 3 s from the global vs 180 from `getSimDiagnostics()`.
 *
 * It cost an audit four probes and two fabricated hypotheses ("the engine stalls", "the engine runs
 * 7.5x fast") before the instrument itself was suspected. ★ A diagnostic that can be stale must
 * either be live or carry its own timestamp; this one was neither. (`__DATA_DIAG__` below is a
 * snapshot too, but it stamps `timestamp`, so a stale read is DETECTABLE — that is the difference.)
 *
 * Configurable so re-running the effect, or a test, can redefine it.
 */
function defineLive(name, read) {
  try {
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get: read });
  } catch (e) { /* a non-configurable prior definition is not worth failing the map over */ }
}

export function useMapDebugTools({
  mapInstance,
  activeLayers,
  activeMarineLayer,
  activeModel,
  debouncedTimeOffsetHours,
  windData,
  marineData,
  simulationField,
  fieldDiagnostics,
  simDiagnostics
}) {
  // React-owned values the effect below publishes. Held in refs so their accessors read the LATEST
  // render rather than the last effect run — the props themselves have no module-level live getter.
  const fceFieldRef = useRef(null);
  const fceDiagRef = useRef(null);
  const simDiagRef = useRef(null);
  fceFieldRef.current = simulationField;
  fceDiagRef.current = fieldDiagnostics;
  simDiagRef.current = simDiagnostics;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── LIVE, not snapshots (see defineLive above) ──────────────────────────────────────────────
    // These two read straight from their engine modules, so they are correct no matter when the
    // effect last ran — that is what makes the stale-by-23.6 s failure structurally impossible.
    defineLive('__SIM_DIAGNOSTICS__', () => {
      try { return getSimDiagnostics(); } catch (e) { return simDiagRef.current; }
    });
    defineLive('__GPU_DISPATCHER__', () => getDispatcherDiagnostics());
    // These two are React-owned; the ref keeps them as fresh as the last render.
    defineLive('__FCE_FIELD__', () => fceFieldRef.current);
    defineLive('__FCE_DIAGNOSTICS__', () => fceDiagRef.current);
    // NOTE: __FCE_RENDER_PLAN__ / __SIM_FRAME__ / __SIM_EVOLUTION__ are now owned by
    // useRenderPlanBridge (written on each throttled sample without a React re-render).
    // This effect no longer depends on the per-frame renderPlan/simFrameIndex, so a
    // bridge update does not re-run it.

    window.__DATA_DIAG__ = {
      wind: {
        hasData: !!windData,
        vectorCount: windData?.vectors?.length || 0,
        gridSize: windData ? `${windData.cols}×${windData.rows}` : 'none',
        source: windData?.source || 'unknown',
        hourOffset: windData?.hourOffset ?? null,
        stale: windData?.stale ?? null,
      },
      marine: {
        hasData: !!marineData,
        featureCount: marineData?.features?.length || 0,
        gridVectorCount: marineData?.grid?.vectors?.length || 0,
        gridSize: marineData?.grid ? `${marineData.grid.cols}×${marineData.grid.rows}` : 'none',
        gridTimestamp: marineData?.grid?.timestamp ? new Date(marineData.grid.timestamp).toISOString() : null,
        ageSec: marineData?.grid?.timestamp ? Math.round((Date.now() - marineData.grid.timestamp) / 1000) : null,
      },
      activeLayer: activeLayers[0] || 'none',
      activeMarineLayer: activeMarineLayer || 'none',
      activeModel,
      timeOffsetHours: debouncedTimeOffsetHours,
      fce: {
        fieldRevision: simulationField?.revision || null,
        fieldSources: simulationField?.sources || null,
        renderPlanExists: !!window.__FCE_LATEST_PLAN__,
        simFrame: window.__SIM_FRAME__ || 0,
      },
      timestamp: new Date().toISOString(),
    };
  }, [
    activeLayers,
    activeMarineLayer,
    activeModel,
    debouncedTimeOffsetHours,
    windData,
    marineData,
    simulationField,
    fieldDiagnostics,
    simDiagnostics
  ]);

  useEffect(() => {
    if (!mapInstance || typeof window === 'undefined') return;

    window.__MAP_INSTANCE__ = mapInstance;

    window.__MAP_DEBUG__ = () => {
      const style = mapInstance.getStyle();
      const layers = style?.layers?.map((l, i) => ({
        idx: i,
        id: l.id,
        type: l.type,
        visibility: l.layout?.visibility ?? 'visible',
        opacity: l.paint?.['raster-opacity'] ?? l.paint?.['circle-opacity'] ?? l.paint?.['fill-opacity'] ?? l.paint?.['line-opacity'] ?? '-',
        fadeDuration: l.paint?.['raster-fade-duration'] ?? '-'
      }));
      console.table(layers);
      console.log('[DEBUG] Total layers:', layers?.length);
      console.log('[DEBUG] Active marine settings:', !!window.__OM_MARINE_SETTINGS__);
      console.log('[DEBUG] Raster sources:', Object.keys(style?.sources || {}).filter(s => s.includes('slot')));
      return layers;
    };

    window.__SOURCECACHE_TRUTH__ = () => {
      const map = mapInstance;
      const style = map.style;
      if (!style) { console.error('Style not loaded'); return null; }

      const report = {};
      const tileManagers = style.tileManagers || style.sourceCaches || {};

      for (const [name, tm] of Object.entries(tileManagers)) {
        if (!name.includes('slot') && !name.includes('radar') && !name.includes('satellite')) continue;
        const src = tm._source || tm.source || {};
        const inView = tm._inViewTiles || tm._tiles || {};
        const outCache = tm._outOfViewCache || tm._cache || {};

        const tileIds = [];
        for (const [tileId, tile] of Object.entries(inView)) {
          tileIds.push({
            id: tileId,
            state: tile.state,
            loaded: tile.loaded,
            zoom: tile.tileID?.canonical?.z || '?',
            x: tile.tileID?.canonical?.x || '?',
            y: tile.tileID?.canonical?.y || '?',
            overscaled: tile.tileID?.overscaledZ > tile.tileID?.canonical?.z
          });
        }

        report[name] = {
          sourceUrl: src.url || '-',
          sourceTiles: src.tiles || '-',
          inViewCount: tileIds.length,
          outOfViewCount: Object.keys(outCache).length,
          overscaledCount: tileIds.filter(t => t.overscaled).length,
          tiles: tileIds
        };
      }

      console.log('%c=== SourceCache Truth ===', 'font-size: 14px; font-weight: bold; color: #00ff88');
      for (const [name, data] of Object.entries(report)) {
        console.log(`%c${name}`, 'color: #44aaff; font-weight: bold');
        console.log('  Source URL:', data.sourceUrl);
        console.log('  Source tiles:', data.sourceTiles);
        console.log(`  In-view: ${data.inViewCount} | Out-of-view: ${data.outOfViewCount} | Overscaled: ${data.overscaledCount}`);
        if (data.tiles.length > 0) console.table(data.tiles);
      }
      return report;
    };

    return () => {
      delete window.__MAP_INSTANCE__;
      delete window.__MAP_DEBUG__;
      delete window.__SOURCECACHE_TRUTH__;
    };
  }, [mapInstance]);
}

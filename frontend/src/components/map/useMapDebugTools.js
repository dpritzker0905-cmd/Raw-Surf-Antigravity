import { useEffect } from 'react';
import { getDispatcherDiagnostics } from '../../engine/RenderPlanDispatcher';

export function useMapDebugTools({
  mapInstance,
  activeLayers,
  activeMarineLayer,
  activeModel,
  debouncedTimeOffsetHours,
  windData,
  marineData,
  simulationField,
  renderPlan,
  fieldDiagnostics,
  simDiagnostics,
  simFrameIndex
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.__FCE_FIELD__ = simulationField;
    window.__FCE_RENDER_PLAN__ = renderPlan;
    window.__FCE_DIAGNOSTICS__ = fieldDiagnostics;
    window.__SIM_DIAGNOSTICS__ = simDiagnostics;
    window.__SIM_FRAME__ = simFrameIndex;
    window.__SIM_EVOLUTION__ = renderPlan?.evolution || null;
    window.__GPU_DISPATCHER__ = getDispatcherDiagnostics();

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
        renderPlanExists: !!renderPlan,
        simFrame: simFrameIndex,
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
    renderPlan,
    fieldDiagnostics,
    simDiagnostics,
    simFrameIndex
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

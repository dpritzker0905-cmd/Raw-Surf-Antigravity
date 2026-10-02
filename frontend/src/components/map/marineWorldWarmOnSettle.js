/**
 * marineWorldWarmOnSettle.js — keep the zoom-out bridge's coarse base ON THE SELECTED HOUR while the user is still zoomed in
 * (2026-10-01; owner: "now fix the wrong-hour frame"; audit F-21; the defect and the other rules are in marineStaleHour.js).
 *
 * The world prewarm ("warm the global WHILE the user is still zoomed in", marineGlobalPrewarm.js) was designed for exactly this,
 * but it only ran from the fetch paths' redirect branches. An hour chosen through the timeline lanes (a cache or series commit)
 * never reached them, so a page that selected Wednesday at a regional zoom held only the page-load world frame (the "now" hour)
 * when the zoom-out came, and the bridge drew it as Wednesday. Offline replay, unfixed: the zoom-out drew the wrong hour for
 * 3.2 to 3.8 s in every variant (jump and wheel, just opened and open a minute; 8.7 s once), at full strength, until the exact
 * world grid arrived.
 *
 * WHAT THIS DOES: once the selected hour has held still for WORLD_WARM_HOLD_MS at a regional viewport (a moved hour or a scrub in
 * progress re-arms the wait; it never gives up on a commit that keeps the same grid), ask the existing prewarm for that hour's world
 * grid (its own gates, valid-time dedupe, cache check and background lane apply; the grid goes out BEFORE the world series half,
 * which used to hold the lane's single slot). When it lands it is cached and staged as the bridge seed, which (marineStaleHour.js)
 * REPLACES a base made for another hour, so a zoom-out after a few seconds of dwell promotes the right hour and never draws a wrong
 * one. If the user zoomed out before it landed, the landing still replaces the base, and the engine's per-frame bridge promotes it
 * over the stale frame already drawn (marineStaleHour.js rule 4).
 *
 * COST, stated: at most one world /grid (2.3 MB, about 3 s of the 1-CPU box) per settled valid time, in the background lane,
 * deduped by valid time (three hour steps share one 3-hourly frame). EURO is excluded (its world product goes through the slow
 * Copernicus transport). Kill: __RAW_DISABLE_HOUR_WORLD_WARM__. Telemetry: window.__MARINE_HOUR_WORLD_WARM__ { fired }; what the
 * prewarm then did is in window.__MARINE_GLOBAL_PREWARM__.
 *
 * THE BAND (2026-10-02; owner: "keep the 2 degree frame for the selected hour at every zoom in that range"; the F-22 follow-up): the call passes
 * `band: true`, so the prewarm also serves a view between its 15 degree regional gate and the bridge's ceiling (40 degrees), GRID ONLY (no world
 * series pages). The F-22 bridge promotes a held 2-degree base for the selected hour there, and until now nothing asked for that frame in that
 * range: the per-fetch prewarm calls and this one were declined as `wide_view`. Kill: __RAW_DISABLE_WORLD_WARM_BAND__.
 */
import { useEffect } from 'react';
import { prewarmGlobalMarineGrid } from './marineGlobalPrewarm';

/** The selected hour must have held still this long, at a regional viewport, before its world grid is warmed. */
export const WORLD_WARM_HOLD_MS = 1500;

/** Test seam. */
export function _resetWorldWarmForTest() {
  if (typeof window !== 'undefined') delete window.__MARINE_HOUR_WORLD_WARM__;
}

function bump(key) {
  if (typeof window === 'undefined') return;
  const t = window.__MARINE_HOUR_WORLD_WARM__ = window.__MARINE_HOUR_WORLD_WARM__ || { fired: 0 };
  t[key] = (t[key] || 0) + 1;
}

export function useMarineWorldWarmOnSettle({
  marineData, mapInstance, timeOffsetRef, activeModelRef, activeMarineLayerRef, activeMarineLayersRef,
}) {
  const g = marineData && marineData.grid;
  useEffect(() => {
    if (!mapInstance || !g) return undefined;
    let timer = null;
    let cancelled = false;
    // The selected hour must hold still for a WHOLE hold. A commit that keeps the same grid object (one 3-hourly frame serving
    // several hours, or a scrub that ends on a resident frame) never re-arms this effect, so a moved hour or a scrub in progress
    // re-arms the wait HERE instead of giving up: the warm for the hour the user settles on must not depend on another commit.
    const arm = (forHour) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        try {
          const w = typeof window !== 'undefined' ? window : null;
          if (w && w.__RAW_DISABLE_HOUR_WORLD_WARM__ === true) return;
          if (activeMarineLayersRef && !activeMarineLayersRef.current) return;
          const hour = timeOffsetRef ? timeOffsetRef.current : undefined;
          if (hour !== forHour || (w && w.isScrubbingTimeline)) { arm(hour); return; }
          const model = (activeModelRef && activeModelRef.current) || 'GFS';
          if (model === 'EURO') return;
          const layer = (activeMarineLayerRef && activeMarineLayerRef.current) || 'waves';
          const b = mapInstance.getBounds();
          const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
          bump('fired');
          prewarmGlobalMarineGrid(model, hour, vb, layer, { gridFirst: true, band: true });
        } catch (e) { /* a warm is best effort: never break the commit that armed it */ }
      }, WORLD_WARM_HOLD_MS);
    };
    arm(timeOffsetRef ? timeOffsetRef.current : undefined);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [g, mapInstance]);
}

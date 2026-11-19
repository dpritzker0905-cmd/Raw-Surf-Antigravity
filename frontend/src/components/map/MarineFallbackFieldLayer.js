/**
 * MarineFallbackFieldLayer: puts marineFallbackField's picture on the map as a plain MapLibre canvas source and raster layer
 * while the marine engine is failed (webglMarineFailed), and MarineEngineFallback, the pair MapWebGL mounts in that state:
 * this field plus the 2D particle canvas that was already there. (2026-11-18, Open-Meteo exit row 12.)
 *
 * It replaces the Open-Meteo marine tiles. There is no path back to them: with no grid of ours, a surf-rating grid, or the
 * kill (window.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true) NOTHING is drawn and the legend says the layer is unavailable
 * (marineFallbackNotice reads the state published here).
 *
 * Redrawn only when the grid, the theme or the anchor changes: no animation loop. With `animate: false` MapLibre reads the
 * canvas once, so after a repaint of the same canvas the source is told to read it again (play, then pause).
 */
import React, { useEffect, useRef } from 'react';
import { MarineParticleCanvas } from './GPUMarineLayer';
import { renderFallbackField, whyNoFallbackField, fallbackOpacityExpression } from './marineFallbackField';

export const FALLBACK_SOURCE_ID = 'own-marine-fallback-source';
export const FALLBACK_LAYER_ID = 'own-marine-fallback-layer';
export const FALLBACK_FIELD_EVENT = 'rawsurf:marine-fallback-field';

const theMap = (m) => (m && typeof m.getMap === 'function' ? m.getMap() : m);
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** What the legend and the lab read: { drawn, reason, width, height, validTime, layer, model, theme, draws, ms }. */
export function publishFallbackField(state) {
  if (typeof window === 'undefined') return;
  const prev = window.__RAW_OWN_MARINE_FALLBACK__ || {};
  const next = { ...prev, ...state, draws: (prev.draws || 0) + (state.drawn ? 1 : 0) };
  window.__RAW_OWN_MARINE_FALLBACK__ = next;
  try { window.dispatchEvent(new CustomEvent(FALLBACK_FIELD_EVENT, { detail: { drawn: !!next.drawn, reason: next.reason || null } })); } catch (e) { /* no CustomEvent */ }
}

export function removeFallbackField(mapInstance) {
  const map = theMap(mapInstance);
  try {
    if (map && map.getLayer && map.getLayer(FALLBACK_LAYER_ID)) map.removeLayer(FALLBACK_LAYER_ID);
    if (map && map.getSource && map.getSource(FALLBACK_SOURCE_ID)) map.removeSource(FALLBACK_SOURCE_ID);
  } catch (e) { /* the style is gone with the map */ }
}

/**
 * Draw (or remove) the field for the current state. `held` keeps the canvas between calls. Never throws: a failure here
 * leaves nothing drawn and says why, it never reaches for another source.
 */
export function syncFallbackField(mapInstance, held, { active, grid, theme, beforeId }) {
  const map = theMap(mapInstance);
  if (!map || !map.addSource) return null;
  const reason = !active ? 'inactive' : whyNoFallbackField(grid);
  let field = null; const t0 = now();
  try { if (!reason) field = renderFallbackField(grid, theme); } catch (e) { field = null; }
  if (!field) {
    removeFallbackField(map);
    const state = { drawn: false, reason: reason || 'no_ocean', theme, layer: (grid && grid.activeMarineLayer) || null };
    publishFallbackField(state); return state;
  }
  try {
    let canvas = held.canvas;
    const sameSize = canvas && canvas.width === field.width && canvas.height === field.height;
    if (!sameSize) { canvas = document.createElement('canvas'); canvas.width = field.width; canvas.height = field.height; held.canvas = canvas; }
    canvas.getContext('2d').putImageData(new ImageData(field.data, field.width, field.height), 0, 0);
    const src = map.getSource(FALLBACK_SOURCE_ID);
    if (src && sameSize && map.getLayer(FALLBACK_LAYER_ID)) {
      src.setCoordinates(field.coordinates);
      src.play(); src.pause();                       // animate:false reads the canvas once; read it again now
    } else {
      removeFallbackField(map);
      map.addSource(FALLBACK_SOURCE_ID, { type: 'canvas', canvas, coordinates: field.coordinates, animate: false });
      const layer = { id: FALLBACK_LAYER_ID, type: 'raster', source: FALLBACK_SOURCE_ID,
        paint: { 'raster-opacity': fallbackOpacityExpression(), 'raster-resampling': 'linear', 'raster-fade-duration': 0 } };
      map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    }
    if (map.triggerRepaint) map.triggerRepaint();
    const state = { drawn: true, reason: null, width: field.width, height: field.height, theme, ms: Math.round((now() - t0) * 10) / 10,
      validTime: grid.valid_time || grid.validTime || null, layer: grid.activeMarineLayer || null, model: grid.__sourceModel || grid.activeModel || null,
      clippedNorth: field.extent.clippedNorth, clippedSouth: field.extent.clippedSouth };
    publishFallbackField(state); return state;
  } catch (e) {
    removeFallbackField(map);
    const state = { drawn: false, reason: 'draw_failed', theme, layer: (grid && grid.activeMarineLayer) || null };
    publishFallbackField(state); return state;
  }
}

export function MarineFallbackFieldLayer({ mapInstance, active, data, theme, beforeId }) {
  const held = useRef({ canvas: null });
  const latest = useRef(null);
  latest.current = { active, grid: data, theme, beforeId };
  useEffect(() => { syncFallbackField(mapInstance, held.current, latest.current); }, [mapInstance, active, data, theme, beforeId]);
  useEffect(() => {
    const map = theMap(mapInstance);
    if (!map || !map.on) return undefined;
    // a theme change swaps the basemap style, which drops every source: put the field back when the new style lands
    const onStyle = () => { try { if (latest.current.active && !map.getSource(FALLBACK_SOURCE_ID)) syncFallbackField(mapInstance, held.current, latest.current); } catch (e) { /* mid-swap */ } };
    map.on('styledata', onStyle);
    return () => { try { map.off('styledata', onStyle); } catch (e) { /* gone */ } removeFallbackField(mapInstance); publishFallbackField({ drawn: false, reason: 'inactive' }); };
  }, [mapInstance]);
  return null;
}

/** What MapWebGL mounts while the marine engine is failed: our own height field under the 2D particle canvas. */
export function MarineEngineFallback({ mapInstance, active, data, revision, theme, beforeId }) {
  return (
    <>
      <MarineFallbackFieldLayer mapInstance={mapInstance} active={active} data={data} theme={theme} beforeId={beforeId} />
      <MarineParticleCanvas id="marine-canvas-layer" mapInstance={mapInstance} active={active} data={data} revision={revision} />
    </>
  );
}

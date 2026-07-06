/**
 * Tile-readiness gate hardening (grey-rectangle class, 2026-07-06, El Salvador repro):
 * isBasemapWaterSourceReady must also consult areTilesLoaded() — isSourceLoaded alone let paints
 * through mid-gesture, baking missing-tile rectangles into the mask as false land that the
 * WIDE-grid overlay REPLACE then rendered at every zoom.
 */
import { isBasemapWaterSourceReady } from './WebGLMarineMaskRenderer';

function makeMap({ sourceLoaded, tilesLoaded, throwOnStyle } = {}) {
  return {
    getStyle: () => {
      if (throwOnStyle) throw new Error('style mid-load');
      return { layers: [{ id: 'water', source: 'composite', 'source-layer': 'water', type: 'fill' }] };
    },
    isSourceLoaded: sourceLoaded === undefined ? undefined : () => sourceLoaded,
    areTilesLoaded: tilesLoaded === undefined ? undefined : () => tilesLoaded,
  };
}

describe('isBasemapWaterSourceReady', () => {
  it('blocks when the water source is not loaded', () => {
    expect(isBasemapWaterSourceReady(makeMap({ sourceLoaded: false, tilesLoaded: true }))).toBe(false);
  });

  it('blocks when the source is loaded but tiles are still loading (the El Salvador hole)', () => {
    expect(isBasemapWaterSourceReady(makeMap({ sourceLoaded: true, tilesLoaded: false }))).toBe(false);
  });

  it('passes when both source and tiles are fully loaded', () => {
    expect(isBasemapWaterSourceReady(makeMap({ sourceLoaded: true, tilesLoaded: true }))).toBe(true);
  });

  it('stays fail-open when the probe methods are unavailable', () => {
    const m = makeMap({});
    delete m.isSourceLoaded;
    delete m.areTilesLoaded;
    expect(isBasemapWaterSourceReady(m)).toBe(true);
  });

  it('stays fail-open when the style throws mid-load', () => {
    expect(isBasemapWaterSourceReady(makeMap({ throwOnStyle: true }))).toBe(true);
  });

  it('blocks on a null map', () => {
    expect(isBasemapWaterSourceReady(null)).toBe(false);
  });
});

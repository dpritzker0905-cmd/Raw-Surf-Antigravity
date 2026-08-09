import { asLandGeoJSON } from './WebGLMarineEngine';

// LAND-GEOJSON ARG GUARD (Report 11.0 R11-10a). The escaped-mask rebuild site passed
// getSharedLandGeoJSON() — a PROMISE, even on cache hit — as setWaveData's geojson argument.
// A Promise is truthy, so it overwrote engine._landGeoJSON; renderMaskToCanvas then saw an input
// with no `.features`, early-returned an all-white canvas, and the engine rendered an ALL-WATER
// world mask (heatmap + crests over every continent) that also poisoned every later null-geojson
// commit until a real layer commit healed it. The bridge site (bridgeToCoarseGlobalIfHeld) fixed
// this class on 2026-07-16 by passing null; the guard makes the contract structural so a fourth
// call site cannot reintroduce it.
describe('asLandGeoJSON — the Promise-as-geojson poison guard', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] };

  it('passes a real FeatureCollection through untouched (same object, not a copy)', () => {
    expect(asLandGeoJSON(fc)).toBe(fc);
  });

  it('passes an EMPTY FeatureCollection (features: []) — deliberate no-land input stays legal', () => {
    const empty = { type: 'FeatureCollection', features: [] };
    expect(asLandGeoJSON(empty)).toBe(empty);
  });

  it('rejects a PROMISE — the live poison: getSharedLandGeoJSON() always returns one', () => {
    expect(asLandGeoJSON(Promise.resolve(fc))).toBeNull();
  });

  it('rejects null/undefined as null (falls through to the stored _landGeoJSON)', () => {
    expect(asLandGeoJSON(null)).toBeNull();
    expect(asLandGeoJSON(undefined)).toBeNull();
  });

  it('rejects truthy junk: strings, numbers, feature-less objects, features-as-non-array', () => {
    expect(asLandGeoJSON('geojson')).toBeNull();
    expect(asLandGeoJSON(1)).toBeNull();
    expect(asLandGeoJSON({})).toBeNull();
    expect(asLandGeoJSON({ features: 'not-an-array' })).toBeNull();
    expect(asLandGeoJSON({ features: {} })).toBeNull();
  });
});

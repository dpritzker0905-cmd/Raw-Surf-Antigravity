import { renderHook } from '@testing-library/react';
import { useMarineWindData } from '../components/map/useMarineWindData';
import { __resetForTests } from '../components/map/marineTransitionCoordinator';

// IS_VALID CARRIED (2026-10-22): the conform is an explicit field list and dropped `is_valid`, so a FLAT frame (a series page or a
// static frame) of a non-waves layer reached the encoder with its land unmarked (the encoder reads land for those layers from the
// vector's top level only). This pins the real hook's output; marineFramePack.parity.test.js proves the encoded bytes.
const mapInstance = { getBounds: () => ({ getWest: () => -5, getEast: () => 5, getSouth: () => -5, getNorth: () => 5 }), getZoom: () => 7 };

// Two flat nodes, as a series page or a static frame carries them: one sea cell, one land cell (is_valid false, zeroed).
function flatFrame(layer) {
  return {
    model: 'GFS',
    grid: {
      bounds: { west: -20, east: 20, south: -20, north: 20 }, cols: 2, rows: 1,
      vectors: [
        { lat: 0, lng: -10, speed: 1.5, u: 1, v: 0, direction: 90, period: 9 },
        { lat: 0, lng: 10, speed: 0, u: 0, v: 0, direction: 0, period: null, is_valid: false },
      ],
      __sourceModel: 'GFS', __gridProvider: 'backend-weather-service', provider: 'backend-weather-service', __gridSupportsLayer: true,
      __componentLayer: layer, __renderable: true, __fromSeries: true, hourOffset: 3, productId: `GFS-${layer}-3`,
    },
  };
}
const conformed = (layer) => renderHook(() => useMarineWindData({ marineData: flatFrame(layer), activeMarineLayer: layer, activeModel: 'GFS',
  timeOffsetHours: 3, mapInstance, viewState: { zoom: 7 } })).result.current;

beforeEach(() => { __resetForTests(); window.__MARINE_FETCH_PENDING__ = null; window.__MARINE_FETCH_DEBOUNCING__ = false; });
afterEach(() => { delete window.__RAW_DISABLE_CONFORM_IS_VALID__; });

test.each(['swell_1', 'swell_2', 'wind_waves', 'waves'])('a flat %s land cell leaves the conform marked invalid; the sea cell is untouched', (layer) => {
  const out = conformed(layer);
  expect(out).not.toBeNull();
  const [sea, land] = out.vectors;
  expect(land.is_valid).toBe(false);
  expect(sea.is_valid).toBeUndefined();
  expect(sea.speed).toBe(1.5);
});

test('the kill switch restores the old field list (no is_valid)', () => {
  window.__RAW_DISABLE_CONFORM_IS_VALID__ = true;
  const out = conformed('swell_1');
  expect(out.vectors[1].is_valid).toBeUndefined();
});

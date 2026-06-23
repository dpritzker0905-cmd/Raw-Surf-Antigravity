import { renderHook } from '@testing-library/react';
import { useMarineWindData } from '../components/map/useMarineWindData';
import {
  __resetForTests,
  beginTransition,
  endCurrentTransition,
  getDisplayed,
  displayMatchesRequested,
} from '../components/map/marineTransitionCoordinator';

const mapInstance = {
  getBounds: () => ({
    getWest: () => -5,
    getEast: () => 5,
    getSouth: () => -5,
    getNorth: () => 5,
  }),
  getZoom: () => 7,
};

function marineFrame({ model = 'GFS', layer = 'waves', hour = 0 } = {}) {
  return {
    model,
    grid: {
      bounds: { west: -20, east: 20, south: -20, north: 20 },
      cols: 1,
      rows: 1,
      vectors: [{
        lat: 0,
        lng: 0,
        isOcean: true,
        [layer]: { u: 1, v: 0, speed: 1, height: 1, period: 8, direction: 90 },
      }],
      __sourceModel: model,
      __gridProvider: 'backend-weather-service',
      provider: 'backend-weather-service',
      __gridSupportsLayer: true,
      __componentLayer: layer,
      __renderable: true,
      hourOffset: hour,
      productId: `${model}-${layer}-${hour}`,
    },
  };
}

beforeEach(() => {
  __resetForTests();
  window.__MARINE_FETCH_PENDING__ = null;
  window.__MARINE_FETCH_DEBOUNCING__ = false;
});

test('a held model-switch frame keeps its true displayed identity', () => {
  const gfsFrame = marineFrame({ model: 'GFS', layer: 'waves', hour: 0 });
  const { result, rerender } = renderHook((props) => useMarineWindData(props), {
    initialProps: {
      marineData: gfsFrame,
      activeMarineLayer: 'waves',
      activeModel: 'GFS',
      timeOffsetHours: 0,
      mapInstance,
      viewState: { zoom: 7 },
    },
  });

  expect(result.current).not.toBeNull();
  expect(getDisplayed()).toMatchObject({ model: 'GFS', layer: 'waves', hour: 0 });

  beginTransition({ model: 'EURO', layer: 'waves', hour: 0 });
  rerender({
    marineData: gfsFrame,
    activeMarineLayer: 'waves',
    activeModel: 'EURO',
    timeOffsetHours: 0,
    mapInstance,
    viewState: { zoom: 7 },
  });

  expect(result.current).not.toBeNull();
  expect(result.current.__sourceModel).toBe('GFS');
  expect(getDisplayed()).toMatchObject({ model: 'GFS', layer: 'waves', hour: 0 });
});

// Integration: hook commit → coordinator records the displayed grid's bounds → the infobox
// parity gate (displayMatchesRequested) confirms the on-screen frame actually covers the point.
test('committed frame records bounds; parity gate enforces viewport containment', () => {
  const gfsFrame = marineFrame({ model: 'GFS', layer: 'waves', hour: 0 }); // bounds -20..20
  const { result } = renderHook((props) => useMarineWindData(props), {
    initialProps: {
      marineData: gfsFrame,
      activeMarineLayer: 'waves',
      activeModel: 'GFS',
      timeOffsetHours: 0,
      mapInstance,
      viewState: { zoom: 7 },
    },
  });

  expect(result.current).not.toBeNull();
  // The hook recorded the grid's coverage on the displayed identity.
  expect(getDisplayed().bounds).toMatchObject({ west: -20, east: 20, south: -20, north: 20 });

  // A point inside the displayed grid → parity holds (grid sample may stand in for the infobox).
  expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 0, lng: 0 })).toBe(true);
  // A point far outside the displayed grid → parity vetoed (do not relabel a different region).
  expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 60, lng: 150 })).toBe(false);
});

test('a model mismatch outside a transition returns null', () => {
  const gfsFrame = marineFrame({ model: 'GFS', layer: 'waves', hour: 0 });
  const { result, rerender } = renderHook((props) => useMarineWindData(props), {
    initialProps: {
      marineData: gfsFrame,
      activeMarineLayer: 'waves',
      activeModel: 'GFS',
      timeOffsetHours: 0,
      mapInstance,
      viewState: { zoom: 7 },
    },
  });

  expect(result.current).not.toBeNull();
  beginTransition({ model: 'EURO', layer: 'waves', hour: 0 });
  endCurrentTransition();
  rerender({
    marineData: gfsFrame,
    activeMarineLayer: 'waves',
    activeModel: 'EURO',
    timeOffsetHours: 0,
    mapInstance,
    viewState: { zoom: 7 },
  });

  expect(result.current).toBeNull();
});
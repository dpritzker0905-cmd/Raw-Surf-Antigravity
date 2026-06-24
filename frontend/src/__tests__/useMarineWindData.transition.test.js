import { renderHook } from '@testing-library/react';
import { useMarineWindData } from '../components/map/useMarineWindData';
import {
  __resetForTests,
  beginTransition,
  endCurrentTransition,
  getDisplayed,
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

function marineFrame({ model = 'GFS', layer = 'waves', hour = 0, speed = 1 } = {}) {
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
        [layer]: { u: speed, v: 0, speed, height: speed, period: 8, direction: 90 },
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

// A full-shape grid (vectors present, __renderable !== false) whose only ocean vector reads
// speed 0 — the conformed-empty / starved-fetch placeholder that BLANKED the heatmap on ICON
// after auto-play scrub. It must be classified non-renderable, not uploaded as an all-zero
// texture.
function zeroFrame({ model = 'GFS', layer = 'waves', hour = 0 } = {}) {
  return marineFrame({ model, layer, hour, speed: 0 });
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

test('an all-zero same-model/layer grid holds the prior good frame instead of blanking', () => {
  const good = marineFrame({ model: 'ICON', layer: 'waves', hour: 0, speed: 9.88 });
  const { result, rerender } = renderHook((props) => useMarineWindData(props), {
    initialProps: {
      marineData: good,
      activeMarineLayer: 'waves',
      activeModel: 'ICON',
      timeOffsetHours: 0,
      mapInstance,
      viewState: { zoom: 7 },
    },
  });

  // Good frame renders.
  expect(result.current).not.toBeNull();
  expect(result.current.__maxHeight).toBeGreaterThan(0);

  // Scrub to a far hour whose per-hour global fetch came back all-zero (max=0.00m), same
  // model/layer. The all-zero frame must NOT be returned as renderable — the prior good frame
  // is held so the heatmap stays up (and the held frame keeps its true hour 0 identity).
  rerender({
    marineData: zeroFrame({ model: 'ICON', layer: 'waves', hour: 266 }),
    activeMarineLayer: 'waves',
    activeModel: 'ICON',
    timeOffsetHours: 266,
    mapInstance,
    viewState: { zoom: 7 },
  });

  expect(result.current).not.toBeNull();
  expect(result.current.__renderable).not.toBe(false);
  expect(result.current.__maxHeight).toBeGreaterThan(0); // held good data, not the zero grid
  expect(result.current.hourOffset).toBe(0); // the held prior frame, not the all-zero hour 266
});

test('an all-zero grid with no prior frame is non-renderable (does not upload a blank texture)', () => {
  const { result } = renderHook((props) => useMarineWindData(props), {
    initialProps: {
      marineData: zeroFrame({ model: 'ICON', layer: 'waves', hour: 266 }),
      activeMarineLayer: 'waves',
      activeModel: 'ICON',
      timeOffsetHours: 266,
      mapInstance,
      viewState: { zoom: 7 },
    },
  });

  // No prior good frame to hold → returns null (render gate shows nothing) rather than a
  // renderable all-zero frame that would blank the GPU texture.
  expect(result.current).toBeNull();
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
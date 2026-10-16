/**
 * WebGLMarineLayer.parity.test.js - the layer's render-hour parity record, driven through the REAL component.
 *
 * The layer publishes window.__MARINE_RENDER_HOUR_PARITY__ and window.__MARINE_HEATMAP_STATUS__ (see marineRenderParity.js).
 * Part 1 (CHARACTERIZATION) pins what the effect published before it was moved out of the component: every reason, every
 * status, the clearing rule, the label-mismatch acceptance, and the effect's dependency list. It passed on the original
 * in-component effect and must keep passing after the extraction.
 * Part 2 (post-upload republish) is the fix, written RED first: the upload that updates lastUploadedGridRef runs AFTER the
 * effect in the same commit (or with no parity-effect dependency changing at all), so the record read the previous frame
 * until something else bumped a dependency.
 *
 * Heavy neighbours (the GL engine, the custom layer, the controller cache) are mocked; everything between the props and the
 * two globals is the real code: safeUploadWaveData, computeVectorDiffAndLog, marineHourInstant, marineFrameInstant.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import WebGLMarineLayer from './WebGLMarineLayer';
import { getSharedLandGeoJSON } from './mapUtils';
import {
  getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine, getMarineHourlyCache,
} from './marineController';
import { isInCooldown } from './marineControllerUtils';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { createCustomLayer, marineRefeedCovers, marineViewportBounds } from './WebGLMarineCustomLayer';

jest.mock('./WebGLMarineEngine', () => ({
  __esModule: true,
  default: class MockMarineEngine {
    constructor() { this._waveData = null; }
    setWaveData(gl, grid) { this._waveData = { waveGrid: grid }; }
    clearBuffers() { this._waveData = null; }
    dispose() {}
  },
}));
jest.mock('../../engine/RenderPlanDispatcher', () => ({
  registerMarineEngine: jest.fn(), unregisterMarineEngine: jest.fn(), updateMarineTruthTrace: jest.fn(),
}));
jest.mock('./WebGLMarineCustomLayer', () => ({
  createCustomLayer: jest.fn(), LAYER_ID: 'webgl-marine-layer', marineRefeedCovers: jest.fn(), marineViewportBounds: jest.fn(),
}));
jest.mock('./mapUtils', () => ({
  getSharedLandGeoJSON: jest.fn(), getSharedLandGeoJSONHiRes: jest.fn(), safeMoveLayer: jest.fn(),
}));
jest.mock('./marineController', () => ({
  getMarineHourlyCache: jest.fn(), getBackendWeatherFlag: jest.fn(), getBackendCopernicusFlag: jest.fn(),
  getBackendIconMarineFlag: jest.fn(), getModelSafeMarine: jest.fn(), prewarmZoomOutMarineGrid: jest.fn(),
}));
jest.mock('./marineControllerUtils', () => ({
  ...jest.requireActual('./marineControllerUtils'),
  isInCooldown: jest.fn(),
}));
jest.mock('./backendWeatherServiceClient', () => ({ getSharedValidTime: jest.fn() }));

const NOON = '2026-10-09T12:00:00.000Z';
const NEVER = '1970-01-01T00:00:00.000Z';
const SENTINEL = { sentinel: true };

function makeMap({ zoom = 4, throwBounds = false } = {}) {
  return {
    style: {},
    painter: { context: { gl: {} } },
    on: jest.fn(), off: jest.fn(),
    getLayer: jest.fn(() => undefined), addLayer: jest.fn(), removeLayer: jest.fn(), moveLayer: jest.fn(),
    getZoom: jest.fn(() => zoom),
    getBounds: jest.fn(() => {
      if (throwBounds) throw new Error('style is still loading');
      return { getWest: () => -10, getSouth: () => 20, getEast: () => 10, getNorth: () => 40 };
    }),
    triggerRepaint: jest.fn(),
  };
}

// A renderable frame. `hour` is the frame's own label (grid.hourOffset); `validTime` its requested instant.
function frame({ hour = 0, model = 'GFS', layer = 'waves', validTime = NOON, seed = 1 } = {}) {
  return {
    vectors: [{ speed: seed }, { speed: seed + 1 }, { speed: seed + 2 }],
    cols: 3, rows: 1, hourOffset: hour,
    __sourceModel: model, __gridProvider: 'open-meteo', __componentLayer: layer, valid_time: validTime,
    __renderable: true,
  };
}

function harness(over = {}) {
  const map = over.mapInstance || makeMap();
  let props = {
    mapInstance: map, active: true, data: null, revision: 0, onAddedChange: jest.fn(), onError: jest.fn(),
    beforeId: undefined, theme: 'dark', activeLayers: ['waves'], activeModel: 'GFS', timeOffsetHours: 0, ...over,
  };
  const utils = render(<WebGLMarineLayer {...props} />);
  return {
    map,
    update(next) { props = { ...props, ...next }; utils.rerender(<WebGLMarineLayer {...props} />); },
    ...utils,
  };
}

const parity = () => window.__MARINE_RENDER_HOUR_PARITY__;
const status = () => window.__MARINE_HEATMAP_STATUS__;

// An hourly timeline around now for the legacy (non-backend) coverage path.
function hourlyTimes(offsetHoursFromNow, count = 24) {
  const base = Math.floor(Date.now() / 3600000) * 3600000 + offsetHoursFromNow * 3600000;
  return Array.from({ length: count }, (_, i) => new Date(base + i * 3600000).toISOString());
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  delete window.__MARINE_RENDER_HOUR_PARITY__;
  delete window.__MARINE_HEATMAP_STATUS__;
  delete window.__RAW_DISABLE_HOUR_BY_INSTANT__;
  delete window.__RAW_DISABLE_PARITY_REPUBLISH__;
  window.__RAW_DISABLE_CLEAR_HOLD__ = true;
  window.__RAW_DISABLE_SWITCH_HOLD__ = true;
  window.isScrubbingTimeline = false;
  window.lastScrubTime = 0;
  getSharedLandGeoJSON.mockImplementation(() => Promise.resolve(null));
  createCustomLayer.mockImplementation(() => ({ id: 'webgl-marine-layer' })); // CRA resets mock implementations before each test
  marineRefeedCovers.mockImplementation(() => true);
  marineViewportBounds.mockImplementation(() => null);
  getBackendWeatherFlag.mockImplementation(() => true);
  getBackendIconMarineFlag.mockImplementation(() => true);
  getBackendCopernicusFlag.mockImplementation(() => true);
  getModelSafeMarine.mockImplementation(() => ({ grid: {} }));
  getMarineHourlyCache.mockImplementation(() => null);
  isInCooldown.mockImplementation(() => false);
  getSharedValidTime.mockImplementation(() => NEVER);
});

afterEach(() => {
  delete window.__RAW_DISABLE_CLEAR_HOLD__;
  delete window.__RAW_DISABLE_SWITCH_HOLD__;
});

describe('characterization: the decision table the effect published before the extraction', () => {
  test('an inactive layer publishes layer_inactive and leaves the heat-map status alone', () => {
    window.__MARINE_HEATMAP_STATUS__ = SENTINEL;
    harness({ active: false, timeOffsetHours: 7 });
    expect(parity()).toEqual({ requestedHour: 7, renderedDataHour: null, parity: false, reason: 'layer_inactive' });
    expect(status()).toBe(SENTINEL);
  });

  test('an active layer that has drawn nothing publishes no_data_rendered and a retained_previous_hour status', () => {
    harness({ timeOffsetHours: 3 });
    expect(parity()).toEqual({ requestedHour: 3, renderedDataHour: null, parity: false, reason: 'no_data_rendered' });
    expect(status()).toEqual({
      status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 3, renderedHour: null, retainedPrevious: true,
    });
  });

  test('a drawn frame of the requested hour publishes parity_match', () => {
    const h = harness({ data: frame({ hour: 0 }), revision: 1 });
    h.update({ revision: 2 });
    expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
  });

  test.each([
    ['retained_previous_hour'], ['no_copernicus_coverage'], ['no_backend_coverage'],
  ])('parity true clears a stale %s status', (stale) => {
    const h = harness({ data: frame({ hour: 0 }), revision: 1 });
    window.__MARINE_HEATMAP_STATUS__ = { status: stale };
    h.update({ revision: 2 });
    expect(parity().parity).toBe(true);
    expect(status()).toBeNull();
  });

  test.each([
    [{ status: 'rate_limited_cached' }], [{ status: 'something_else' }],
  ])('parity true leaves a %j status alone', (other) => {
    const h = harness({ data: frame({ hour: 0 }), revision: 1 });
    window.__MARINE_HEATMAP_STATUS__ = other;
    h.update({ revision: 2 });
    expect(status()).toBe(other);
  });

  describe('a drawn frame of another hour', () => {
    // hour 0 is drawn, hour 5 is asked for (the data prop still holds hour 0)
    const behind = (over = {}) => {
      const h = harness({ data: frame({ hour: 0 }), revision: 1, ...over });
      h.update({ timeOffsetHours: 5 });
      return h;
    };

    test('retained_previous when the backend has the hour and no cooldown is active', () => {
      behind();
      expect(parity()).toEqual({ requestedHour: 5, renderedDataHour: 0, parity: false, reason: 'retained_previous' });
      expect(status()).toEqual({
        status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 5, renderedHour: 0, retainedPrevious: true,
      });
    });

    test('cooldownActive publishes a rate_limited_cached status', () => {
      isInCooldown.mockImplementation((domain) => domain === 'marine');
      behind();
      expect(parity().reason).toBe('cooldownActive');
      expect(status().status).toBe('rate_limited_cached');
      expect(isInCooldown).toHaveBeenCalledWith('marine');
    });

    test.each([
      ['no cached entry', () => null],
      ['a stale-hour entry', () => ({ __staleHour: true })],
      ['an entry with a failure reason', () => ({ __failureReason: 'x' })],
      ['an entry whose grid carries a failure reason', () => ({ grid: { __failureReason: 'x' } })],
    ])('coverageMissing when the backend cache has %s (GFS: no_backend_coverage)', (_label, cached) => {
      getModelSafeMarine.mockImplementation(cached);
      isInCooldown.mockImplementation(() => true); // coverage is judged first
      behind();
      expect(parity().reason).toBe('coverageMissing');
      expect(status().status).toBe('no_backend_coverage');
    });

    test('EURO coverage gaps publish no_copernicus_coverage', () => {
      getModelSafeMarine.mockImplementation(() => null);
      const h = harness({ activeModel: 'EURO', data: frame({ hour: 0, model: 'EURO' }), revision: 1 });
      h.update({ timeOffsetHours: 5 });
      expect(parity().reason).toBe('coverageMissing');
      expect(status().status).toBe('no_copernicus_coverage');
      expect(status().model).toBe('EURO');
    });

    test('ICON follows the icon backend flag; with it off the legacy cache decides', () => {
      getBackendIconMarineFlag.mockImplementation(() => false);
      getModelSafeMarine.mockImplementation(() => null);
      const h = harness({ activeModel: 'ICON', data: frame({ hour: 0, model: 'ICON' }), revision: 1 });
      h.update({ timeOffsetHours: 5 });
      expect(getModelSafeMarine).not.toHaveBeenCalled();
      expect(parity().reason).toBe('coverageMissing'); // the legacy cache is empty
    });

    test('asks the backend cache for the requested hour, the active layer and the viewport', () => {
      const h = harness({ activeLayers: ['rating', 'swell_1'], data: frame({ hour: 0, layer: 'swell_1' }), revision: 1 });
      h.update({ timeOffsetHours: 5 });
      expect(getModelSafeMarine).toHaveBeenLastCalledWith('GFS', 5, 'swell_1', { west: -10, south: 20, east: 10, north: 40 });
      expect(status().layer).toBe('swell_1');
    });

    test('defaults the layer to waves when no marine layer is active', () => {
      const h = harness({ activeLayers: ['wind'], data: frame({ hour: 0 }), revision: 1 });
      h.update({ timeOffsetHours: 5 });
      expect(getModelSafeMarine).toHaveBeenLastCalledWith('GFS', 5, 'waves', expect.any(Object));
    });

    test('a map whose bounds throw is asked with null bounds and does not break the record', () => {
      const h = harness({ mapInstance: makeMap({ throwBounds: true }), data: frame({ hour: 0 }), revision: 1 });
      h.update({ timeOffsetHours: 5 });
      expect(getModelSafeMarine).toHaveBeenLastCalledWith('GFS', 5, 'waves', null);
      expect(parity().reason).toBe('retained_previous');
    });

    test('a null model counts as GFS for the backend flag', () => {
      const h = harness({ data: frame({ hour: 0 }), revision: 1 });
      h.update({ activeModel: null, timeOffsetHours: 5 });
      expect(getModelSafeMarine).toHaveBeenLastCalledWith(null, 5, 'waves', expect.any(Object));
      expect(parity().reason).toBe('retained_previous');
    });

    test('with no backend flag on, a legacy hourly cache within 3 h of the target is retained_previous', () => {
      getBackendWeatherFlag.mockImplementation(() => false);
      getMarineHourlyCache.mockImplementation(() => ({ results: [{ hourly: { time: hourlyTimes(-24, 400) } }] }));
      behind();
      expect(getModelSafeMarine).not.toHaveBeenCalled();
      expect(parity().reason).toBe('retained_previous');
    });

    test('a legacy hourly timeline without a trailing Z is read as UTC', () => {
      getBackendWeatherFlag.mockImplementation(() => false);
      getMarineHourlyCache.mockImplementation(() => ({
        results: [{ hourly: { time: hourlyTimes(-24, 400).map((t) => t.replace(/\.\d+Z$/, '')) } }],
      }));
      behind();
      expect(parity().reason).toBe('retained_previous');
    });

    test('a legacy cache whose nearest hour is more than 3 h from the target is coverageMissing', () => {
      getBackendWeatherFlag.mockImplementation(() => false);
      getMarineHourlyCache.mockImplementation(() => ({ results: [{ hourly: { time: hourlyTimes(-200, 24) } }] }));
      behind();
      expect(parity().reason).toBe('coverageMissing');
    });

    test.each([
      ['no cache', () => null],
      ['an empty cache', () => ({ results: [] })],
      ['a cache with no time array', () => ({ results: [{ hourly: {} }] })],
    ])('a legacy cache that is %s is coverageMissing', (_label, cache) => {
      getBackendWeatherFlag.mockImplementation(() => false);
      getMarineHourlyCache.mockImplementation(cache);
      behind();
      expect(parity().reason).toBe('coverageMissing');
    });

    test('a GFS legacy path is still the legacy path when only another model has a backend flag', () => {
      getBackendWeatherFlag.mockImplementation(() => false);
      getModelSafeMarine.mockImplementation(() => null);
      behind();
      expect(getModelSafeMarine).not.toHaveBeenCalled();
    });
  });

  describe('a label that differs from the selected hour', () => {
    // GFS waves are 3-hourly: offset 16 asks for 13:00Z, the manifest snaps it to the 12Z product the series labelled 15
    const labelled15 = () => frame({ hour: 15, validTime: NOON });
    const served = (hour) => (hour === 16 || hour === 15 ? NOON : NEVER);

    test('a 12Z frame labelled 15 serves the selected hour 16 (marineHourInstant.uploadedGridServesHour)', () => {
      getSharedValidTime.mockImplementation(served);
      const h = harness({ data: labelled15(), revision: 1, timeOffsetHours: 15 });
      h.update({ timeOffsetHours: 16 });
      expect(parity()).toEqual({ requestedHour: 16, renderedDataHour: 15, parity: true, reason: 'parity_match' });
    });

    test('and it clears the Stale Hour Retained status', () => {
      getSharedValidTime.mockImplementation(served);
      const h = harness({ data: labelled15(), revision: 1, timeOffsetHours: 15 });
      window.__MARINE_HEATMAP_STATUS__ = { status: 'retained_previous_hour' };
      h.update({ timeOffsetHours: 16 });
      expect(status()).toBeNull();
    });

    test('the kill switch __RAW_DISABLE_HOUR_BY_INSTANT__ restores the label test', () => {
      getSharedValidTime.mockImplementation(served);
      window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true;
      const h = harness({ data: labelled15(), revision: 1, timeOffsetHours: 15 });
      h.update({ timeOffsetHours: 16 });
      expect(parity()).toEqual({ requestedHour: 16, renderedDataHour: 15, parity: false, reason: 'retained_previous' });
    });

    test('a different instant is not served', () => {
      getSharedValidTime.mockImplementation(() => '2026-10-09T15:00:00.000Z');
      const h = harness({ data: labelled15(), revision: 1, timeOffsetHours: 15 });
      h.update({ timeOffsetHours: 16 });
      expect(parity().parity).toBe(false);
    });

    test('a frame of another model is not served by instant', () => {
      getSharedValidTime.mockImplementation(served);
      const h = harness({ data: labelled15(), revision: 1, timeOffsetHours: 15 });
      h.update({ activeModel: 'EURO', timeOffsetHours: 16 });
      expect(parity().parity).toBe(false);
    });
  });

  describe('the effect dependency list', () => {
    const settled = () => {
      const h = harness({ data: frame({ hour: 0 }), revision: 1 });
      window.__MARINE_RENDER_HOUR_PARITY__ = SENTINEL;
      return h;
    };

    test.each([
      ['revision', { revision: 2 }],
      ['timeOffsetHours', { timeOffsetHours: 1 }],
      ['active', { active: false }],
      ['activeModel', { activeModel: 'EURO' }],
    ])('a change of %s republishes', (_name, change) => {
      settled().update(change);
      expect(parity()).not.toBe(SENTINEL);
    });

    test.each([
      ['theme', { theme: 'light' }],
      ['activeLayers', { activeLayers: ['waves', 'extra'] }],
      ['data', { data: frame({ hour: 0, seed: 9 }) }],
      ['beforeId', { beforeId: 'labels' }],
    ])('a change of %s alone does not', (_name, change) => {
      settled().update(change);
      expect(parity()).toBe(SENTINEL);
    });
  });
});

describe('part 2: the upload republishes the record', () => {
  beforeEach(() => { delete window.__WEBGL_MARINE_UPLOAD_COUNT__; });

  describe('the frame is delivered with NO parity-effect dependency changing (the refeed effect uploads it)', () => {
    test('a frame that serves the requested hour flips the record from false to true', () => {
      const h = harness({ data: null, revision: 1 });
      expect(parity().reason).toBe('no_data_rendered');
      expect(status().status).toBe('retained_previous_hour');
      h.update({ data: frame({ hour: 0 }) }); // `data` is not a dependency of the parity effect
      expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
      expect(status()).toBeNull();
    });

    test('a frame of an OLDER hour leaves parity false and says retained_previous (not no_data_rendered)', () => {
      const h = harness({ data: null, revision: 1, timeOffsetHours: 5 });
      h.update({ data: frame({ hour: 0 }) });
      expect(parity()).toEqual({ requestedHour: 5, renderedDataHour: 0, parity: false, reason: 'retained_previous' });
      expect(status()).toEqual({
        status: 'retained_previous_hour', model: 'GFS', layer: 'waves', hour: 5, renderedHour: 0, retainedPrevious: true,
      });
    });

    test('a frame labelled 15 that is the 12Z product serves the selected hour 16', () => {
      getSharedValidTime.mockImplementation((hour) => (hour === 16 ? NOON : NEVER));
      const h = harness({ data: null, revision: 1, timeOffsetHours: 16 });
      h.update({ data: frame({ hour: 15, validTime: NOON }) });
      expect(parity()).toEqual({ requestedHour: 16, renderedDataHour: 15, parity: true, reason: 'parity_match' });
    });

    test('it reads the CURRENT hour, model and layer, not the ones the effect last ran with', () => {
      const h = harness({ data: null, revision: 1, timeOffsetHours: 0 });
      h.update({ timeOffsetHours: 9 }); // the effect runs here: no_data_rendered at 9
      h.update({ data: frame({ hour: 9 }) });
      expect(parity()).toEqual({ requestedHour: 9, renderedDataHour: 9, parity: true, reason: 'parity_match' });
    });
  });

  describe('the frame is delivered in the same commit that changes a dependency (Home after a scrub)', () => {
    test('the effect ran before the upload, and the record still ends on the frame that was drawn', () => {
      const h = harness({ data: frame({ hour: 72 }), revision: 1, timeOffsetHours: 72 });
      h.update({ revision: 2 });
      expect(parity().parity).toBe(true);
      h.update({ data: frame({ hour: 0, seed: 5 }), revision: 3, timeOffsetHours: 0 });
      expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
    });

    test('first activation with a frame already in hand does not read no_data_rendered', () => {
      harness({ data: frame({ hour: 0 }), revision: 1 });
      expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: 0, parity: true, reason: 'parity_match' });
      expect(status()).toBeNull();
    });
  });

  describe('an inactive layer', () => {
    test('stays layer_inactive when the land mask swap uploads the retained frame', async () => {
      getSharedLandGeoJSON.mockImplementation(() => Promise.resolve({ features: [] }));
      const before = { status: 'retained_previous_hour' };
      window.__MARINE_HEATMAP_STATUS__ = before;
      harness({ active: false, data: frame({ hour: 0 }), revision: 1 });
      await act(async () => {});
      expect(window.__WEBGL_MARINE_UPLOAD_COUNT__).toBe(1); // the swap really uploaded
      expect(parity().parity).toBe(false);
      expect(parity().reason).toBe('layer_inactive');
      expect(status()).toBe(before);
    });
  });

  describe('the record after the layer empties the engine (the stale-true mirror image)', () => {
    const drawn = () => {
      const h = harness({ data: frame({ hour: 0 }), revision: 1 });
      h.update({ revision: 2 }); // before the fix this bump is what first showed parity_match
      expect(parity().parity).toBe(true);
      return h;
    };

    test('an unsupported-layer frame clears the engine: nothing is drawn, the record says so', () => {
      const h = drawn();
      h.update({ data: { vectors: [], __unsupportedLayer: true }, revision: 3 });
      expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: null, parity: false, reason: 'no_data_rendered' });
      expect(status().status).toBe('retained_previous_hour');
    });

    test('a non-renderable frame after a model switch clears the engine: the record says nothing is drawn', () => {
      const h = drawn();
      h.update({ activeModel: 'EURO', data: { vectors: [], __renderable: false }, revision: 3 });
      expect(parity().renderedDataHour).toBeNull();
      expect(parity().reason).toBe('no_data_rendered');
    });

    test('deactivation clears the engine: the record is layer_inactive and carries no drawn hour', () => {
      const h = drawn();
      h.update({ active: false });
      expect(parity()).toEqual({ requestedHour: 0, renderedDataHour: null, parity: false, reason: 'layer_inactive' });
    });
  });

  describe('the kill switch __RAW_DISABLE_PARITY_REPUBLISH__', () => {
    test('restores today: the record stays stale until a dependency changes, and the upload itself is unaffected', () => {
      window.__RAW_DISABLE_PARITY_REPUBLISH__ = true;
      const h = harness({ data: null, revision: 1 });
      h.update({ data: frame({ hour: 0 }) });
      expect(window.__WEBGL_MARINE_UPLOAD_COUNT__).toBe(1);
      expect(parity().reason).toBe('no_data_rendered');
      h.update({ revision: 2 }); // today's only fix: another dependency change
      expect(parity().reason).toBe('parity_match');
    });

    test('only strict true disables it', () => {
      window.__RAW_DISABLE_PARITY_REPUBLISH__ = 'true';
      const h = harness({ data: null, revision: 1 });
      h.update({ data: frame({ hour: 0 }) });
      expect(parity().reason).toBe('parity_match');
    });
  });

  describe('a failing publisher never breaks the upload', () => {
    test('an exception while judging coverage is swallowed and the frame is still uploaded', () => {
      const h = harness({ data: null, revision: 1, timeOffsetHours: 5 });
      getModelSafeMarine.mockImplementation(() => { throw new Error('cache exploded'); });
      expect(() => h.update({ data: frame({ hour: 0 }) })).not.toThrow();
      expect(window.__WEBGL_MARINE_UPLOAD_COUNT__).toBe(1);
      expect(window.__WEBGL_MARINE_UPLOAD_DIAG__.renderAccepted).toBe(true); // the code AFTER the republish still ran
    });
  });
});

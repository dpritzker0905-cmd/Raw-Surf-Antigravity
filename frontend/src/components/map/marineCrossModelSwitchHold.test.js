/**
 * Cross-model switch must never blank the drawn heatmap (EURO Waves repro, 2026-11-08). Mocks only; the REAL WebGLMarineLayer runs.
 * A resident GFS frame is drawn, the map switches to EURO/waves, and the target answers with a non-renderable / empty first response
 * (what buildCopernicusEmptyGrid commits) before a real frame. The engine resident must survive every step of the interlude.
 */
import React from 'react';
import { render } from '@testing-library/react';
import WebGLMarineLayer from './WebGLMarineLayer';
import { getSharedLandGeoJSON, getSharedLandGeoJSONHiRes } from './mapUtils';
import {
  getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine, getMarineHourlyCache,
} from './marineController';
import { isInCooldown } from './marineControllerUtils';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { createCustomLayer, marineRefeedCovers, marineViewportBounds } from './WebGLMarineCustomLayer';
import { buildCopernicusEmptyGrid } from './useMarineDataFetcherHelpers';

jest.mock('./WebGLMarineEngine', () => ({
  __esModule: true,
  default: class MockMarineEngine {
    constructor() { this._waveData = null; global.__lastMockEngine = this; }
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
jest.mock('./marineControllerUtils', () => ({ ...jest.requireActual('./marineControllerUtils'), isInCooldown: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({ getSharedValidTime: jest.fn() }));

const TILE = { west: -82, south: 26, east: -76.75, north: 32.25 };
const makeMap = () => ({
  style: {}, painter: { context: { gl: {} } }, on: jest.fn(), off: jest.fn(), getLayer: jest.fn(() => undefined),
  addLayer: jest.fn(), removeLayer: jest.fn(), moveLayer: jest.fn(), getZoom: jest.fn(() => 9), triggerRepaint: jest.fn(),
  getBounds: jest.fn(() => ({ getWest: () => -80.9, getSouth: () => 27.5, getEast: () => -78.9, getNorth: () => 29.5 })),
});
const frame = (model) => ({
  vectors: [{ speed: 1 }, { speed: 2 }, { speed: 3 }], cols: 3, rows: 1, hourOffset: 0, bounds: TILE,
  __sourceModel: model, __gridProvider: 'backend-weather-service', __componentLayer: 'waves', valid_time: '2026-11-08T12:00:00.000Z', __renderable: true,
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  ['__RAW_DISABLE_SWITCH_HOLD__', '__RAW_DISABLE_CLEAR_HOLD__', '__WEBGL_MARINE_CLEAR_COUNT__', '__MARINE_TRANSITIONING__',
    '__MARINE_FETCH_PENDING__', '__MARINE_FETCH_DEBOUNCING__'].forEach((k) => { delete window[k]; });
  window.isScrubbingTimeline = false; window.lastScrubTime = 0;
  getSharedLandGeoJSON.mockImplementation(() => Promise.resolve(null));
  getSharedLandGeoJSONHiRes.mockImplementation(() => Promise.resolve(null));
  createCustomLayer.mockImplementation(() => ({ id: 'webgl-marine-layer' }));
  marineRefeedCovers.mockImplementation(() => true); marineViewportBounds.mockImplementation(() => null);
  getBackendWeatherFlag.mockImplementation(() => true); getBackendIconMarineFlag.mockImplementation(() => true);
  getBackendCopernicusFlag.mockImplementation(() => true); getModelSafeMarine.mockImplementation(() => ({ grid: {} }));
  getMarineHourlyCache.mockImplementation(() => null); isInCooldown.mockImplementation(() => false);
  getSharedValidTime.mockImplementation(() => '1970-01-01T00:00:00.000Z');
});

function mount() {
  let props = { mapInstance: makeMap(), active: true, data: frame('GFS'), revision: 1, onAddedChange: jest.fn(), onError: jest.fn(),
    theme: 'dark', activeLayers: ['waves'], activeModel: 'GFS', timeOffsetHours: 0 };
  const utils = render(<WebGLMarineLayer {...props} />);
  return { update(n) { props = { ...props, ...n }; utils.rerender(<WebGLMarineLayer {...props} />); } };
}
const resident = () => global.__lastMockEngine && global.__lastMockEngine._waveData;

describe('switching GFS -> EURO waves with an empty / non-renderable first answer', () => {
  test.each([
    ['null data, no transition flags', () => null],
    ['the Copernicus empty grid as derived data (no vectors)', () => ({ ...buildCopernicusEmptyGrid(TILE, 0, 'waves', 'unavailable').grid, vectors: [], __renderable: false })],
    ['the held previous frame under the new model (renderable flag false)', () => ({ ...frame('GFS'), __renderable: false })],
  ])('keeps the drawn frame: %s', (_n, make) => {
    const h = mount();
    expect(resident()).toBeTruthy();
    h.update({ activeModel: 'EURO', data: make(), revision: 2 });
    expect(resident()).toBeTruthy();
    expect(window.__WEBGL_MARINE_CLEAR_COUNT__ || 0).toBe(0);
    h.update({ activeModel: 'EURO', data: frame('EURO'), revision: 3 });
    expect(resident().waveGrid.__sourceModel).toBe('EURO');
  });
});

describe('other windows of the same switch', () => {
  test('the layer blinking inactive across the switch (flags already dropped) keeps the resident', () => {
    const h = mount();
    h.update({ activeModel: 'EURO', data: null, revision: 2, active: false });
    expect(resident()).toBeTruthy();
    h.update({ activeModel: 'EURO', data: null, revision: 3, active: true });
    expect(resident()).toBeTruthy();
    expect(window.__WEBGL_MARINE_CLEAR_COUNT__ || 0).toBe(0);
  });

  test('an encode that throws leaves the engine empty and is attributable (engine_encode_throw), not a silent clear', () => {
    const h = mount();
    const eng = global.__lastMockEngine;
    eng.setWaveData = function throwing() { this._waveData = null; throw new Error('texture upload failed'); };
    window.__MARINE_CLEAR_LOG__ = [];
    h.update({ activeModel: 'EURO', data: frame('EURO'), revision: 2 });
    expect(window.__WEBGL_MARINE_ENCODE_THROW__.count).toBeGreaterThanOrEqual(1);
    expect(window.__WEBGL_MARINE_ENCODE_THROW__.last).toMatchObject({ message: 'texture upload failed', model: 'EURO', residentLeft: false });
    expect(window.__MARINE_CLEAR_LOG__.map((e) => e.reason)).toContain('engine_encode_throw');
  });
});

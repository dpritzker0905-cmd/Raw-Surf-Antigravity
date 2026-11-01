/**
 * THE LAYER'S END (2026-10-27). The lead's live read on dev 89a494aca (EURO waves, z9 over the Florida east coast, 13:58-14:08Z):
 * timeline hours 141-155 read "Loading <hour>… still showing Mon, Nov 2, 4 AM" at all 15 hours while every /grid answered 200, and
 * window.__RAW_FRAME_STORE__ counted 18 `no_target` misses. `no_target` means the frame store had no layer to draw into:
 * WebGLMarineLayer was UNMOUNTED. That happens only when MapWebGL swaps it for the simplified fallback (webglMarineFailed: the WebGL
 * guardrail's 12 s under 20 fps, or the render-error path). The drawn-frame record is a module singleton, so it went on describing
 * the layer's last frame (11-02T09Z, a EURO regional estimate, runMs null), and the status line said a load was under way for good.
 * Offline (scn_euro_z9_band.js TRIP_AT=133 on a non-local host) the same trip reproduces every count: 18 steps of "Loading…
 * still showing" over the frame drawn before the trip, no_target 1 -> 18, no commit, every /grid 200, and the first step after the
 * guardrail's 60 s retry draws again (the live h156).
 * The fix: the layer RETIRES the record when it unmounts, and the status line says the simplified layer is on while the fallback is
 * engaged. Kill: window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ = true.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { formatInstant } from './drawnFrameReadout';
import * as drawnModule from './marineDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';
import WebGLMarineLayer from './WebGLMarineLayer';
import { getSharedLandGeoJSON, getSharedLandGeoJSONHiRes } from './mapUtils';
import {
  getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine, getMarineHourlyCache,
} from './marineController';
import { isInCooldown } from './marineControllerUtils';
import { createCustomLayer, marineRefeedCovers, marineViewportBounds } from './WebGLMarineCustomLayer';

// The layer's heavy neighbours (as WebGLMarineLayer.parity.test.js): everything between the props and the drawn record is real.
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
jest.mock('./marineControllerUtils', () => ({ ...jest.requireActual('./marineControllerUtils'), isInCooldown: jest.fn() }));

const H = 3600000;
const ANCHOR = Date.UTC(2026, 9, 27, 14);          // round(now) at 13:58Z: timeline hour 0
const SERVED_H140 = Date.UTC(2026, 10, 2, 9);       // what h140 (11-02T10Z) drew: the florida_east_coast estimate, 09Z
const SERVED_H156 = Date.UTC(2026, 10, 3, 3);       // what h156 (11-03T02Z) drew after the retry: 03Z
const NOW = ANCHOR - 2 * 60000;                  // 13:58Z
const BAND = Array.from({ length: 15 }, (_, i) => 141 + i);
// The words date both times once the selection is six or more days out (drawnFrameReadout.datedPair): h144 on at 13:58Z.
const dated = (hour) => ANCHOR + hour * H - NOW >= 6 * 24 * H;
const FALLBACK_WORDS = 'Simplified wave layer (reduced graphics mode): this app’s forecast frames are off';

/** The conformed /grid answer the engine held (useMarineWindData): the ask echo, the readout-only served time, no verified cycle. */
const regionalEstimate = (hour, servedMs) => ({
  hourOffset: hour, __componentLayer: 'waves', __sourceModel: 'EURO', valid_time: new Date(ANCHOR + hour * H).toISOString(),
  __readoutServedTime: new Date(servedMs).toISOString(), is_estimated: true, model_run_time: null, model_run_time_status: 'conflicting',
  estimate_basis: { type: 'euro_persistence_gfs_blend' }, provider: 'estimated',
});
/** What MapWebGL does when the guardrail trips (or recovers): the state, and the event the legend listens to. */
const setFallback = (on) => {
  window.__WEBGL_GUARDRAIL_FALLBACK__ = { webglWindFailed: false, webglMarineFailed: on };
  window.dispatchEvent(new CustomEvent('rawsurf:marine-fallback', { detail: { marineFailed: on } }));
};
const retire = () => { if (typeof drawnModule.retireMarineDrawn === 'function') drawnModule.retireMarineDrawn('layer_unmounted'); };
const line = () => screen.getByRole('status');

beforeEach(() => {
  window.__MOCK_DATE_NOW__ = NOW;                  // 13:58Z: the app asks on round(now) = 14Z
  jest.spyOn(Date, 'now').mockReturnValue(NOW);    // and the line dates its words from the same clock
});
afterEach(() => {
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__;
  delete window.__WEBGL_GUARDRAIL_FALLBACK__;
  drawnModule._resetMarineDrawnForTest();
  jest.restoreAllMocks();
});

describe('the live band: the simplified fallback engaged at h140 and the line spoke from the unmounted layer', () => {
  it('control: before the trip, h140 over the 09Z estimate reads "nearest" (the line is right while the layer draws)', () => {
    act(() => { drawnModule.publishMarineDrawn(regionalEstimate(140, SERVED_H140)); });
    render(<ForecastTimeStatus model="EURO" layer="waves" hour={140} theme="dark" />);
    expect(line()).toHaveAttribute('data-drawn-state', 'nearest');
  });

  it('after the trip, none of hours 141-155 says a load is under way or names the retired frame', () => {
    act(() => { drawnModule.publishMarineDrawn(regionalEstimate(140, SERVED_H140)); });
    const view = render(<ForecastTimeStatus model="EURO" layer="waves" hour={140} theme="dark" />);
    act(() => { retire(); setFallback(true); });
    const said = BAND.map((hour) => { view.rerender(<ForecastTimeStatus model="EURO" layer="waves" hour={hour} theme="dark" />); return line(); });
    said.forEach((el) => {
      expect(el).not.toHaveTextContent('still showing');
      expect(el).not.toHaveAttribute('aria-busy');
      expect(el).toHaveAttribute('data-drawn-state', 'fallback');
      expect(el).toHaveTextContent(FALLBACK_WORDS);
    });
    expect(drawnModule.getMarineDrawn()).toBeNull();
    expect(window.__MARINE_DRAWN__).toBeNull();
  });

  it('POSITIVE CONTROL (the kill): the same 15 hours read the live line, "Loading <hour>… still showing" the 09Z frame', () => {
    window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ = true;
    act(() => { drawnModule.publishMarineDrawn(regionalEstimate(140, SERVED_H140)); });
    const view = render(<ForecastTimeStatus model="EURO" layer="waves" hour={140} theme="dark" />);
    act(() => { retire(); setFallback(true); });
    BAND.forEach((hour) => {
      view.rerender(<ForecastTimeStatus model="EURO" layer="waves" hour={hour} theme="dark" />);
      // Live (EST): "Loading Mon 6 AM… still showing Mon 4 AM" at h141, "Loading Mon, Nov 2, 9 AM… still showing Mon, Nov 2, 4 AM" at h144.
      const d = dated(hour);
      expect(line()).toHaveTextContent(`Loading ${formatInstant(ANCHOR + hour * H, d)}… still showing ${formatInstant(SERVED_H140, d)}`);
      expect(line()).toHaveAttribute('data-drawn-state', 'pending');
    });
  });

  it('the retry: once the layer is back and draws h156 (03Z), the line reads the drawn frame again', () => {
    act(() => { drawnModule.publishMarineDrawn(regionalEstimate(140, SERVED_H140)); });
    const view = render(<ForecastTimeStatus model="EURO" layer="waves" hour={150} theme="dark" />);
    act(() => { retire(); setFallback(true); });
    expect(line()).toHaveAttribute('data-drawn-state', 'fallback');
    act(() => { setFallback(false); drawnModule.publishMarineDrawn(regionalEstimate(156, SERVED_H156)); });
    view.rerender(<ForecastTimeStatus model="EURO" layer="waves" hour={156} theme="dark" />);
    expect(line()).toHaveAttribute('data-drawn-state', 'nearest');
    // The estimate's own words since 2026-10-28 (statusLineWords.test.js: every marine basis is worded; was "(estimated)").
    expect(line()).toHaveTextContent(`Showing ${formatInstant(SERVED_H156, dated(156))}: the nearest stored forecast (beyond EURO’s range, blended with GFS)`);
  });

  it('the fallback line in every theme: a polite status, words not colour', () => {
    act(() => { retire(); setFallback(true); });
    ['dark', 'light', 'beach'].forEach((theme) => {
      const { unmount } = render(<ForecastTimeStatus model="EURO" layer="waves" hour={148} theme={theme} />);
      expect(line()).toHaveAttribute('aria-live', 'polite');
      expect(line()).toHaveTextContent(FALLBACK_WORDS);
      unmount();
    });
  });

  it('a raster layer\'s line is not the marine fallback\'s to speak for', () => {
    act(() => { setFallback(true); });
    render(<ForecastTimeStatus model="EURO" layer="pressure" hour={148} theme="dark" />);
    expect(screen.queryByText(FALLBACK_WORDS)).toBeNull();
  });
});

// The swap itself, through the REAL layer: the record is published at the upload and retired when MapWebGL unmounts the layer.
function makeMap() {
  return {
    style: {}, painter: { context: { gl: {} } }, on: jest.fn(), off: jest.fn(),
    getLayer: jest.fn(() => undefined), addLayer: jest.fn(), removeLayer: jest.fn(), moveLayer: jest.fn(),
    getZoom: jest.fn(() => 9),
    getBounds: jest.fn(() => ({ getWest: () => -81.2, getSouth: () => 27.8, getEast: () => -79.6, getNorth: () => 28.9 })),
    triggerRepaint: jest.fn(),
  };
}
const frame = (hour) => ({
  vectors: [{ speed: 1.1 }, { speed: 1.2 }, { speed: 1.3 }], cols: 3, rows: 1, hourOffset: hour, __sourceModel: 'EURO',
  __gridProvider: 'estimated', __componentLayer: 'waves', valid_time: new Date(ANCHOR + hour * H).toISOString(), __renderable: true,
  __readoutServedTime: new Date(SERVED_H140).toISOString(), is_estimated: true,
});
const layerProps = (over = {}) => ({
  mapInstance: makeMap(), active: true, data: frame(140), revision: 1, onAddedChange: jest.fn(), onError: jest.fn(),
  beforeId: undefined, theme: 'dark', activeLayers: ['waves'], activeModel: 'EURO', timeOffsetHours: 140, ...over,
});

describe('WebGLMarineLayer retires the drawn record when it unmounts (the fallback swap)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    window.__RAW_DISABLE_CLEAR_HOLD__ = true;
    window.__RAW_DISABLE_SWITCH_HOLD__ = true;
    window.isScrubbingTimeline = false;
    getSharedLandGeoJSON.mockImplementation(() => Promise.resolve(null));
    getSharedLandGeoJSONHiRes.mockImplementation(() => Promise.resolve(null));   // z9 asks for the 10 m coastline
    createCustomLayer.mockImplementation(() => ({ id: 'webgl-marine-layer' }));
    marineRefeedCovers.mockImplementation(() => true);
    marineViewportBounds.mockImplementation(() => null);
    [getBackendWeatherFlag, getBackendIconMarineFlag, getBackendCopernicusFlag].forEach((f) => f.mockImplementation(() => true));
    getModelSafeMarine.mockImplementation(() => ({ grid: {} }));
    getMarineHourlyCache.mockImplementation(() => null);
    isInCooldown.mockImplementation(() => false);
  });
  afterEach(() => { delete window.__RAW_DISABLE_CLEAR_HOLD__; delete window.__RAW_DISABLE_SWITCH_HOLD__; });

  it('the upload publishes h140; the unmount leaves no record describing it', () => {
    const view = render(<WebGLMarineLayer {...layerProps()} />);
    view.rerender(<WebGLMarineLayer {...layerProps({ revision: 2 })} />);
    expect(drawnModule.getMarineDrawn()).toMatchObject({ hour: 140, model: 'EURO', dataMs: SERVED_H140 });
    view.unmount();
    expect(drawnModule.getMarineDrawn()).toBeNull();
    expect(window.__MARINE_DRAWN__).toBeNull();
  });

  it('kill: __RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ keeps today\'s record after the unmount', () => {
    window.__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__ = true;
    const view = render(<WebGLMarineLayer {...layerProps()} />);
    view.rerender(<WebGLMarineLayer {...layerProps({ revision: 2 })} />);
    view.unmount();
    expect(drawnModule.getMarineDrawn()).toMatchObject({ hour: 140, dataMs: SERVED_H140 });
  });
});

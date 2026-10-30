/**
 * NOTHING DRAWN (D2, 2026-10-28; the lead's offline erratic fuzzer at 4bd90d0d9). After a camera move off the resident regional frame
 * plus a time step, the sea stayed blank for 5-21 s while the line said "Loading X… still showing Y". Repro (min-blank-home, phone):
 * ICON Waves at Florida z5.2 -> jump to h191 -> ease to SoCal z6.1 -> Home. The resident Florida crop went off screen (the layer drew it
 * at 0 and nothing under it), `engine_clear` ran, and nothing drew for 5.1 s; the drawn record went on describing the cleared frame.
 *
 * Pinned here:
 *  - marineDrawnFrame.syncDrawnToEngine: the record describes what is ON SCREEN: an empty engine, or a frame the layer drew nothing of,
 *    retires it (kill __RAW_DISABLE_DRAWN_NOTHING_TRUTH__); the next drawn frame publishes again.
 *  - ForecastTimeStatus: with the record retired for nothing drawn, the line says only "Loading <selected>…".
 *  - marineGlobalPrewarm.askWashOnRefusal({ rejected: true }): the layer that drew nothing asks for the selected hour's world grid, which
 *    the engine's bridge promotes (kill __RAW_DISABLE_REJECT_WORLD_ASK__); the custom layer's call sites are pinned in source.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render, screen } from '@testing-library/react';

jest.mock('./marineGridSeries', () => ({ ensureMarineSeries: jest.fn(), getMarineSeriesFrame: jest.fn(() => null), runBackgroundWarm: jest.fn((fn) => fn()) }));
jest.mock('./backendCopernicusServiceClient', () => ({ fetchBackendCopernicusGrid: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({
  fetchBackendMarineGrid: jest.fn(), getSharedValidTime: jest.fn(), getSeriesAnchorMs: jest.fn(), getSurfModeFlag: jest.fn(() => false),
}));

const drawn = require('./marineDrawnFrame');
const { formatInstant } = require('./drawnFrameReadout');
const ForecastTimeStatus = require('./ForecastTimeStatus').default;
const prewarm = require('./marineGlobalPrewarm');
const { fetchBackendMarineGrid, getSharedValidTime, getSeriesAnchorMs } = require('./backendWeatherServiceClient');
const { runBackgroundWarm } = require('./marineGridSeries');

const H = 3600000;
const ANCHOR = Date.UTC(2026, 9, 28, 15);
const NOW = ANCHOR - 60000;
const crop = (hour, served) => ({ hourOffset: hour, __componentLayer: 'waves', __sourceModel: 'ICON', bounds: { west: -95, south: 15, east: -67, north: 32 },
  valid_time: new Date(ANCHOR + hour * H).toISOString(), __readoutServedTime: new Date(served).toISOString(), cols: 15, rows: 17 });
const engineHolding = (g) => ({ _waveData: g ? { waveGrid: g } : null });
const line = () => screen.getByRole('status');

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  getSeriesAnchorMs.mockReturnValue(ANCHOR);
  getSharedValidTime.mockImplementation((h) => new Date(ANCHOR + h * H).toISOString());
});
afterEach(() => {
  drawn._resetMarineDrawnForTest();
  delete window.__MARINE_DRAWN_RETIRED__; delete window.__RAW_DISABLE_DRAWN_NOTHING_TRUTH__; delete window.__RAW_DISABLE_REJECT_WORLD_ASK__;
  delete window.__MARINE_WASH_TIME__; delete window.__MARINE_ENGINE__;
  jest.restoreAllMocks();
});

describe('the record describes what is on screen', () => {
  const h191 = crop(191, ANCHOR + 191 * H);
  it('an off-screen resident drawn at 0 retires the record; drawing it again publishes it again', () => {
    drawn.syncDrawnToEngine(engineHolding(h191), {});
    expect(drawn.getMarineDrawn()).toMatchObject({ hour: 191, model: 'ICON' });
    drawn.syncDrawnToEngine(engineHolding(h191), {}, { drawn: false });
    expect(drawn.getMarineDrawn()).toBeNull();
    expect(window.__MARINE_DRAWN_RETIRED__.reason).toBe('off_screen');
    drawn.syncDrawnToEngine(engineHolding(h191), {});
    expect(drawn.getMarineDrawn()).toMatchObject({ hour: 191 });
  });
  it('an empty engine (the engine_clear of the repro) retires the record', () => {
    drawn.syncDrawnToEngine(engineHolding(h191), {});
    drawn.syncDrawnToEngine(engineHolding(null), {});
    expect(drawn.getMarineDrawn()).toBeNull();
    expect(window.__MARINE_DRAWN_RETIRED__.reason).toBe('engine_empty');
  });
  it('kill: __RAW_DISABLE_DRAWN_NOTHING_TRUTH__ keeps describing the cleared frame (the old record)', () => {
    window.__RAW_DISABLE_DRAWN_NOTHING_TRUTH__ = true;
    drawn.syncDrawnToEngine(engineHolding(h191), {});
    drawn.syncDrawnToEngine(engineHolding(null), {});
    expect(drawn.getMarineDrawn()).toMatchObject({ hour: 191 });
  });
});

describe('the line while nothing is drawn: "Loading <selected>…", never "still showing"', () => {
  it('the repro after Home (h0) with the h191 crop cleared: the old line named the cleared frame; the new one only the load', () => {
    act(() => { drawn.syncDrawnToEngine(engineHolding(crop(191, ANCHOR + 191 * H)), {}); });
    const view = render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="light" />);
    expect(line()).toHaveTextContent('still showing');                                    // the frame is still drawn here: the old words are right
    act(() => { drawn.syncDrawnToEngine(engineHolding(null), {}); });
    view.rerender(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="light" />);
    expect(line()).toHaveTextContent(`Loading ${formatInstant(ANCHOR)}…`);
    expect(line()).not.toHaveTextContent('still showing');
    expect(line()).toHaveAttribute('data-drawn-state', 'pending');
    expect(line()).toHaveAttribute('aria-busy', 'true');
  });
  it('every theme words it; a raster layer is not spoken for', () => {
    act(() => { drawn.syncDrawnToEngine(engineHolding(crop(3, ANCHOR + 3 * H)), {}); drawn.syncDrawnToEngine(engineHolding(null), {}); });
    ['dark', 'light', 'beach'].forEach((theme) => {
      const { unmount } = render(<ForecastTimeStatus model="GFS" layer="waves" hour={6} theme={theme} />);
      expect(line()).toHaveTextContent(`Loading ${formatInstant(ANCHOR + 6 * H)}…`);
      unmount();
    });
    const { container } = render(<ForecastTimeStatus model="GFS" layer="precipitation" hour={6} theme="dark" />);
    expect(container.textContent).not.toMatch(/Loading .*…$/);
  });
});

describe('the layer that drew nothing asks for the selected hour\'s world grid', () => {
  const vp = { west: -125, south: 28, east: -114, north: 37 };
  beforeEach(() => {
    prewarm._resetGlobalPrewarmDedupeForTest(); prewarm._resetWashAsksForTest();
    runBackgroundWarm.mockImplementation((fn) => fn());   // CRA's resetMocks strips factory implementations
    prewarm.registerPrewarmDeps({ getModelSafeMarine: () => null, cacheMarineResult: jest.fn(), isSiblingPrewarmEnabled: () => true });
    fetchBackendMarineGrid.mockResolvedValue({ grid: { bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 181, rows: 83,
      vectors: [{ lat: 0, lng: 0, speed: 1 }], valid_time: new Date(ANCHOR).toISOString() } });
    window.__MARINE_ENGINE__ = {};
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it('no wash refusal needed: a rejected frame asks once per hour per gap, and the landing is staged for the engine', async () => {
    expect(prewarm.askWashOnRefusal({ model: 'ICON', layer: 'waves', hour: 0, bounds: vp, nowMs: 1000 })).toBe(false);   // not rejected, not refused
    expect(prewarm.askWashOnRefusal({ model: 'ICON', layer: 'waves', hour: 0, bounds: vp, nowMs: 1000, rejected: true })).toBe(true);
    expect(prewarm.askWashOnRefusal({ model: 'ICON', layer: 'waves', hour: 0, bounds: vp, nowMs: 1500, rejected: true })).toBe(false);
    await flush(); await flush();
    expect(fetchBackendMarineGrid).toHaveBeenCalledTimes(1);
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeTruthy();
    expect(window.__MARINE_WASH_TIME__.askedRejected).toBe(1);
  });
  it('kill: __RAW_DISABLE_REJECT_WORLD_ASK__', () => {
    window.__RAW_DISABLE_REJECT_WORLD_ASK__ = true;
    expect(prewarm.askWashOnRefusal({ model: 'ICON', layer: 'waves', hour: 0, bounds: vp, nowMs: 1000, rejected: true })).toBe(false);
  });
  it('the custom layer: the bail path and the drawn-at-0 path both retire the record and ask (in source)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
    expect(src).toMatch(/if \(bailed\) syncDrawnToEngine\(eng, \{\}, \{ drawn: false \}\);/);
    expect(src).toMatch(/askRejectedWorld\(this, engine, viewportBounds, true\); return;/);
    expect(src).toMatch(/if \(!_rej\.coarseBridge\) this\._nothingDrawn = true;/);
    expect(src).toMatch(/\{ drawn: !\(this\._nothingDrawn && !\(opacityMultiplier > 0\)\) \}\);\s*\r?\n\s*if \(this\._nothingDrawn && !\(opacityMultiplier > 0\)\) askRejectedWorld\(this, engine, viewportBounds, false\);/);
    expect(src).toMatch(/this\._nothingDrawn = false;/);
  });
});

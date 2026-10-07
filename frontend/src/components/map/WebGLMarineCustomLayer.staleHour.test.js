/**
 * The custom layer hands the engine a DIMMED multiplier for a world frame made for another hour (2026-10-01, audit F-21).
 *
 * marineStaleHour.test.js and marineStaleHourLayer.test.js pin the rules; these tests pin the CALL SITE (the recorded class of
 * "green unit tests, nothing wired"): the REAL layer renders against a fake engine and the multiplier is read off engine.render's
 * eighth argument, in the same frame the engine would draw.
 */
import fs from 'fs';
import path from 'path';
import { createCustomLayer } from './WebGLMarineCustomLayer';
import { STALE_WORLD_DIM, STALE_HOLD_MS } from './marineStaleHour';
import { _resetSelectedMemoForTest } from './marineStaleHourLayer';

const ref = (current) => ({ current });
const ANCHOR = Date.parse('2026-10-01T12:00:00Z');
const NOW0 = '2026-10-01T12:00:00Z';
const WED15 = '2026-10-07T15:00:00Z';                                  // the anchor + 147 h
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const grid = (vt, bounds = WORLD) => ({ bounds, cols: 181, rows: 82, valid_time: vt });

/** A far-zoom viewport by default; `regional` is a zoom-9 view inside the TILE (a regional grid that covers it draws untouched). */
const mkMap = ({ regional = false } = {}) => ({
  getBounds: () => (regional
    ? ({ getWest: () => -81, getEast: () => -80, getSouth: () => 27, getNorth: () => 28 })
    : ({ getWest: () => -170, getEast: () => 20, getSouth: () => -50, getNorth: () => 60 })),
  getZoom: () => (regional ? 9 : 2.4), getCanvas: () => ({ width: 800, height: 600 }),
  isZooming: () => false, isMoving: () => false, triggerRepaint: jest.fn(),
});

function makeLayer(resident, { hour = 147, regional = false, map } = {}) {
  const engine = { clearBuffers: jest.fn(), render: jest.fn(), _initialized: true, _waveData: resident ? { waveGrid: resident } : null };
  const hourRef = ref(hour);
  const layer = createCustomLayer(engine, ref(true), ref(map || mkMap({ regional })), ref(null), ref(null), ref(null),
    ref('dark'), ref(null), ref(false), ref(['waves']), hourRef, ref(null), ref('GFS'));
  return { layer, engine, hourRef };
}
const frame = (layer) => layer.render({ gl: {}, defaultProjectionData: { mainMatrix: new Float32Array(16) } });
const opacityOf = (engine) => engine.render.mock.calls[engine.render.mock.calls.length - 1][7];

beforeAll(() => {
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(ANCHOR + 10 * 60 * 1000);
  _resetSelectedMemoForTest();
  window.__RAW_GPU__ = {};
  window.__MOCK_DATE_NOW__ = ANCHOR;
  window.__RAW_MARINE_XFAM_HOLD_DISABLED__ = true;
  delete window.isScrubbingTimeline;
  delete window.__MARINE_TRANSITIONING__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_FETCH_DEBOUNCING__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__RAW_GPU__;
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_MARINE_XFAM_HOLD_DISABLED__;
  delete window.__RAW_DISABLE_STALE_HOUR_DIM__;
  jest.restoreAllMocks();
});

describe('the multiplier the real layer passes to engine.render', () => {
  it('the page-load world frame while Wednesday is selected: full strength while the hour is still moving, dimmed once it has held', () => {
    const { layer, engine } = makeLayer(grid(NOW0));
    frame(layer);
    expect(opacityOf(engine)).toBe(1);                                  // the first frame at this hour: a scrub never flickers
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(opacityOf(engine)).toBe(STALE_WORLD_DIM);
    expect(window.__RAW_GPU__.staleHour).toMatchObject({ stale: true, why: 'stale_world', mult: STALE_WORLD_DIM });
  });

  it('hands the engine the selected instant while the stale frame is dimmed (its per-frame bridge may then promote the held base), and nothing otherwise', () => {
    const { layer, engine } = makeLayer(grid(NOW0));
    frame(layer);
    expect(engine.__staleSwapMs).toBeNull();
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(engine.__staleSwapMs).toBe(Date.parse(WED15));
    const right = makeLayer(grid(WED15));
    frame(right.layer);
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(right.layer);
    expect(right.engine.__staleSwapMs).toBeNull();
  });

  it('the right-hour world frame is drawn at full strength however long it is held', () => {
    const { layer, engine } = makeLayer(grid(WED15));
    frame(layer);
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(opacityOf(engine)).toBe(1);
  });

  it('a regional frame is never dimmed by this (the display gate and coverage rules own it)', () => {
    const { layer, engine } = makeLayer(grid(NOW0, TILE), { regional: true });
    frame(layer);
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(opacityOf(engine)).toBe(1);
    expect(window.__RAW_GPU__.staleHour).toMatchObject({ stale: false, why: 'not_world' });
  });

  it('MULTIPLIES the opacity the zoom rules computed: a regional frame mid zoom-out keeps its fade (it is never reset to 1)', () => {
    // No readable viewport + zoom 6.0 + a moving map: the layer's own fade is (6.0 - 5.5) / (6.5 - 5.5) = 0.5.
    const map = { ...mkMap(), getBounds: () => { throw new Error('no bounds'); }, getZoom: () => 6.0, isZooming: () => true };
    const { layer, engine } = makeLayer(grid(NOW0, TILE), { map });
    frame(layer);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(opacityOf(engine)).toBeCloseTo(0.5, 5);
  });

  it('the hour moving restarts the clock: the next frame is full strength again', () => {
    const { layer, engine, hourRef } = makeLayer(grid(NOW0));
    frame(layer);
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(opacityOf(engine)).toBe(STALE_WORLD_DIM);
    hourRef.current = 148;
    frame(layer);
    expect(opacityOf(engine)).toBe(1);
  });

  it('the kill switch restores the old draw, and an engine with no frame is untouched', () => {
    window.__RAW_DISABLE_STALE_HOUR_DIM__ = true;
    const { layer, engine } = makeLayer(grid(NOW0));
    frame(layer);
    jest.advanceTimersByTime(STALE_HOLD_MS + 50);
    frame(layer);
    expect(opacityOf(engine)).toBe(1);
    delete window.__RAW_DISABLE_STALE_HOUR_DIM__;
    const empty = makeLayer(null);
    frame(empty.layer);
    expect(opacityOf(empty.engine)).toBe(1);
  });

  it('a layer with no hour ref (older call sites) falls back to hour 0 and never throws', () => {
    const engine = { clearBuffers: jest.fn(), render: jest.fn(), _initialized: true, _waveData: { waveGrid: grid(NOW0) } };
    const layer = createCustomLayer(engine, ref(true), ref(mkMap()), ref(null), ref(null), ref(null),
      ref('dark'), ref(null), ref(false), ref(['waves']), undefined, ref(null), undefined);
    expect(() => frame(layer)).not.toThrow();
    expect(opacityOf(engine)).toBe(1);                                  // hour 0 IS the page-load hour: not stale
  });
});

describe('the call site, in source', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
  it('multiplies (never replaces) the opacity the zoom rules computed, immediately before the engine draws', () => {
    expect(src).toMatch(/opacityMultiplier \*= staleWorldDimMult\(engine, _staleHour,[\s\S]{0,200}\);\s*\r?\n\s*if \(!engine\._initialized \|\| !engine\._waveData\) stampSkip\(_stamp, SKIP\.ENGINE_NO_DATA\);\s*\r?\n\s*engine\.render\(/);
  });
  it('the tracker lives per layer, not per frame (a per-frame tracker would never see the hour hold)', () => {
    const top = src.indexOf('export function createCustomLayer');
    const ret = src.indexOf('const layer = {', top);
    expect(ret).toBeGreaterThan(top);
    const tracker = src.indexOf('createStaleHourTracker()', top);
    expect(tracker).toBeGreaterThan(top);
    expect(tracker).toBeLessThan(ret);
  });
});

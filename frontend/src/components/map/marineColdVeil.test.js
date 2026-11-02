/**
 * D3 (the lead's offline fuzzer, 2026-10-27): the cold veil held the heatmap at opacity 0 for ~3.9 s after the first frame while the
 * status line said "Showing …" (or nothing) about a frame that was not on screen. marineColdVeil.js applies the veil per frame (the
 * engine's former inline block, unchanged in what it draws) and tells the status line while it hides the field.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ForecastTimeStatus from './ForecastTimeStatus';
import { applyColdVeil, clearColdVeil, describeColdVeil, getColdVeilState, noteColdVeilStamp, subscribeColdVeil, VEIL_WORDS, _resetColdVeilForTest } from './marineColdVeil';
import { resolveColdVeil } from './marineEngineDecisions';
import { publishMarineDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';

const COAST = [-80.9, 27.9, -79.9, 28.6];      // Cocoa z9-ish: ~1 deg wide
const WIDE = [-100, 10, -60, 40];               // 40 deg
const opts = (extra = {}) => ({ residentCoarseGlobal: true, vb: COAST, isRating: false, debugIsolate: false, ...extra });

afterEach(() => { _resetColdVeilForTest(); delete window.__RAW_DISABLE_VEIL_WORDS__; delete window.__RAW_GPU__; });

describe('applyColdVeil: the engine block moved here draws exactly what it drew', () => {
  test('same multiplier and veil state as resolveColdVeil over a whole lifecycle (hide, adequate lift, 350 ms ramp)', () => {
    const eng = { _coldVeil: { t0: 1000 } }; const ref = { t0: 1000 };
    const steps = [[1100, opts()], [2000, opts()], [2500, opts({ residentCoarseGlobal: false })], [2675, opts({ residentCoarseGlobal: false })],
      [2850, opts({ residentCoarseGlobal: false })], [2900, opts({ residentCoarseGlobal: false })]];
    let refVeil = ref;
    for (const [t, o] of steps) {
      const m = applyColdVeil(eng, { ...o, nowMs: t }, {});
      const r = resolveColdVeil(refVeil, { residentCoarseGlobal: o.residentCoarseGlobal, viewportSpanDeg: 1.0, isRating: false }, t, {});
      refVeil = r.veil;
      expect(m).toBeCloseTo(r.mult, 9);
      expect(!!eng._coldVeil).toBe(!!refVeil);
    }
    expect(eng._coldVeil).toBeNull();
  });

  test('__RAW_GPU__.coldVeil keeps its shape (the fuzzer and HUD read it)', () => {
    window.__RAW_GPU__ = {};
    const eng = { _coldVeil: { t0: 1000 } };
    applyColdVeil(eng, { ...opts(), nowMs: 1500 }, window);
    expect(window.__RAW_GPU__.coldVeil).toMatchObject({ mult: 0, lifted: false, reason: null });   // + preview fields (the preview PR)
    applyColdVeil(eng, { ...opts(), nowMs: 5100 }, window);                       // grace (4 s) expired
    expect(window.__RAW_GPU__.coldVeil).toMatchObject({ mult: 0, lifted: true, reason: 'grace' });
    applyColdVeil(eng, { ...opts(), nowMs: 5500 }, window);
    expect(window.__RAW_GPU__.coldVeil).toBeNull();
  });

  test('wide view and the kill switch never veil (the multiplier is 1 from the first frame)', () => {
    expect(applyColdVeil({ _coldVeil: { t0: 1000 } }, { ...opts({ vb: WIDE }), nowMs: 1010 }, {})).toBe(1);
    expect(applyColdVeil({ _coldVeil: { t0: 1000 } }, { ...opts(), nowMs: 1500 }, { __RAW_DISABLE_COLD_COARSE_VEIL__: true })).toBe(1);
    expect(getColdVeilState().phase).toBeNull();
  });
});

describe('the phase the status line reads', () => {
  test("'hidden' while the veil holds the heatmap at 0; null from the lift (the field is then on screen); one notice per change", () => {
    const seen = []; subscribeColdVeil(() => seen.push(getColdVeilState().phase));
    const eng = { _coldVeil: { t0: 1000 } };
    applyColdVeil(eng, { ...opts(), nowMs: 1100 }, {});
    applyColdVeil(eng, { ...opts(), nowMs: 1200 }, {});
    expect(getColdVeilState().phase).toBe('hidden');
    applyColdVeil(eng, { ...opts({ residentCoarseGlobal: false }), nowMs: 1800 }, {});   // the detailed tile: the ramp's first frame is still 0
    expect(getColdVeilState().phase).toBe('hidden');
    applyColdVeil(eng, { ...opts({ residentCoarseGlobal: false }), nowMs: 1816 }, {});   // the first frame above 0: the field is on screen
    expect(getColdVeilState().phase).toBeNull();
    applyColdVeil(eng, { ...opts({ residentCoarseGlobal: false }), nowMs: 2300 }, {});
    expect(seen).toEqual(['hidden', null]);
  });

  test('the cold commit publishes the phase at once when the viewport is known (no "Showing …" before the first heatmap pass)', () => {
    const coarse = { bounds: { west: -180, east: 180, south: -80, north: 84 }, cols: 181, rows: 83 };
    const eng = { _coldVeil: { t0: performance.now() }, _lastViewportBounds: COAST };
    noteColdVeilStamp(eng, coarse, {});
    expect(getColdVeilState().phase).toBe('hidden');
    expect(eng._coldVeil.hid).toBeUndefined();                                   // decided on a copy: the render pass stamps
    _resetColdVeilForTest();
    noteColdVeilStamp({ ...eng, _lastViewportBounds: WIDE }, coarse, {});        // a wide view never veils
    noteColdVeilStamp({ ...eng, _lastViewportBounds: undefined }, coarse, {});   // unknown viewport: the first render decides
    noteColdVeilStamp(eng, { ...coarse, cols: 1441, bounds: { west: -82, east: -78, south: 26, north: 30 } }, {});   // a regional tile
    expect(getColdVeilState().phase).toBeNull();
  });

  test('the engine clear (layer off, model-switch clear) ends the words', () => {
    applyColdVeil({ _coldVeil: { t0: 1000 } }, { ...opts(), nowMs: 1100 }, {});
    expect(getColdVeilState().phase).toBe('hidden');
    clearColdVeil();
    expect(getColdVeilState().phase).toBeNull();
  });

  test('words: a pending line for a marine layer; none for another layer, none when killed', () => {
    expect(describeColdVeil({ phase: 'hidden' }, { layer: 'waves' }, {})).toEqual({ state: 'pending', veil: 'hidden', text: VEIL_WORDS });
    expect(describeColdVeil({ phase: 'hidden' }, { layer: 'swell_2' }, {}).text).toBe('Loading the detailed forecast…');
    expect(describeColdVeil({ phase: 'hidden' }, { layer: 'rain' }, {})).toBeNull();
    expect(describeColdVeil({ phase: null }, { layer: 'waves' }, {})).toBeNull();
    expect(describeColdVeil({ phase: 'hidden' }, { layer: 'waves' }, { __RAW_DISABLE_VEIL_WORDS__: true })).toBeNull();
  });
});

describe('the status line (ForecastTimeStatus) while the veil hides the 2-degree first frame', () => {
  beforeEach(() => { jest.useFakeTimers('modern'); jest.setSystemTime(Date.parse('2026-11-01T16:20:00Z')); _resetMarineDrawnForTest(); });
  afterEach(() => { jest.useRealTimers(); delete window.__FORECAST_TIMELINE_COVERAGE_DIAG__; });
  // The instant 2-deg world frame for 15Z under an hour-0 selection at 16Z: the drawn record says "Showing 3 PM: the nearest …".
  const coarseFirstFrame = () => publishMarineDrawn({
    hourOffset: 0, __componentLayer: 'waves', __sourceModel: 'GFS', bounds: { west: -180, east: 180, south: -80, north: 84 }, cols: 181, rows: 83,
    served_valid_time: '2026-11-01T15:00:00Z', is_estimated: false, estimate_basis: null,
  });

  test.each(['light', 'dark', 'beach'])('%s: "Loading the detailed forecast…" (polite, busy), never "Showing …"; the lift restores the drawn words', (theme) => {
    coarseFirstFrame();
    render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme={theme} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Showing .*nearest stored forecast/);   // control: the words before the veil
    const eng = { _coldVeil: { t0: performance.now() } };
    act(() => { applyColdVeil(eng, { ...opts() }, {}); });
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent('Loading the detailed forecast…');
    expect(line).not.toHaveTextContent(/Showing/);
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line).toHaveAttribute('data-drawn-state', 'pending');
    expect(line).toHaveAttribute('data-cold-veil', 'hidden');
    act(() => { applyColdVeil(eng, { ...opts({ residentCoarseGlobal: false }) }, {}); });   // the detailed tile lands (ramp frame 0)
    act(() => { applyColdVeil(eng, { ...opts({ residentCoarseGlobal: false }), nowMs: performance.now() + 20 }, {}); });
    expect(screen.getByRole('status')).not.toHaveTextContent('Loading the detailed forecast');
  });

  test('kill switch: the line describes the drawn record as before (the live D3 reading)', () => {
    window.__RAW_DISABLE_VEIL_WORDS__ = true;
    coarseFirstFrame();
    render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme="dark" />);
    act(() => { applyColdVeil({ _coldVeil: { t0: performance.now() } }, { ...opts() }, {}); });
    expect(screen.getByRole('status')).toHaveTextContent(/^Showing .*nearest stored forecast/);
  });
});

/**
 * The labelled coarse preview (D3 path 3; ON by default, the owner's pick 2026-11-01 20:02 EST: "Yes, show preview"; kill
 * window.__RAW_DISABLE_COLD_PREVIEW__ = true). During the cold veil it paints the 2-degree first frame at the blend-base wash strength (0.72) with words that say what it is, over open
 * water only, and cross-fades to the detail with the veil's 350 ms smoothstep from that strength.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ForecastTimeStatus from './ForecastTimeStatus';
import fs from 'fs';
import path from 'path';
import { applyColdVeil, clearColdVeil, coastTestCount, getColdVeilState, noteColdVeilStamp, previewCoastal, previewWords, _resetColdVeilForTest } from './marineColdVeil';
import { coastInBox } from './marineCoastTest';
import { _resetMarineDrawnForTest } from './marineDrawnFrame';

// The map's own land: the Natural Earth 50 m polygons MapPage fetches (getSharedLandGeoJSON) and the engine masks with.
const LAND = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/ne_50m_land.json'), 'utf8'));
const NO_LAND = { type: 'FeatureCollection', features: [] };   // a world with no coast at all (to isolate the grid's own rules)
const COCOA = [-80.9, 27.9, -79.9, 28.6];          // inside florida_east_coast (a pilot box)
const OCEAN = [-50.6, 29.6, -49.4, 30.4];          // the open Atlantic, far from any pilot box and any land node
// The 2-deg world tier as it arrives (global_mid 181 x 83, row 0 = south); `land` marks nodes invalid.
const world = (land = () => false) => {
  const cols = 181; const rows = 83; const vectors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = -80 + 2 * r; const lng = -180 + 2 * c;
    vectors.push(land(lat, lng) ? { speed: 0, is_valid: false } : { speed: 1.2, is_valid: true });
  }
  return { cols, rows, vectors, bounds: { west: -180, east: 180, south: -80, north: 84 }, __sourceModel: 'GFS',
    served_valid_time: '2026-11-01T15:00:00Z', model_run_time: '2026-11-01T12:00:00Z', model_run_time_status: 'known' };
};
const ON = (extra = {}) => ({ ...extra });                                     // the default: no flag needed
const KILLED = { __RAW_DISABLE_COLD_PREVIEW__: true };
const opts = (vb, grid = world(), extra = {}) => ({ residentCoarseGlobal: true, vb, grid, isRating: false, ...extra });

afterEach(() => { _resetColdVeilForTest(); });

describe("ON by default (the owner's pick); the kill switch restores the blank veil", () => {
  test('with no flag at all the open-water veil paints the preview', () => {
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(OCEAN), nowMs: 1500 }, {})).toBeCloseTo(0.72, 9);
    expect(getColdVeilState().phase).toBe('preview');
  });
  test('__RAW_DISABLE_COLD_PREVIEW__ hides the field exactly as before (multiplier 0, the loading words), stamp and render alike', () => {
    const m = applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(OCEAN), nowMs: 1500 }, KILLED);
    expect(m).toBe(0);
    expect(getColdVeilState().phase).toBe('hidden');
    _resetColdVeilForTest();
    noteColdVeilStamp({ _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND, _lastViewportBounds: OCEAN }, world(), KILLED);
    expect(getColdVeilState().phase).toBe('hidden');
  });
  test('the old opt-in name does nothing now (it was never shipped)', () => {
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(OCEAN), nowMs: 1500 }, { __RAW_COLD_PREVIEW__: false })).toBeCloseTo(0.72, 9);
  });
});

describe('the preview over open water', () => {
  test('paints the 2-deg field at the blend-base wash strength (0.72) and publishes the preview words', () => {
    const m = applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(OCEAN), nowMs: 1500 }, ON());
    expect(m).toBeCloseTo(0.72, 9);
    const s = getColdVeilState();
    expect(s.phase).toBe('preview');
    expect(s).toMatchObject({ model: 'GFS', deg: 2, dataMs: Date.parse('2026-11-01T15:00:00Z'), runMs: Date.parse('2026-11-01T12:00:00Z') });
    expect(previewWords(s)).toMatch(/^Coarse 2° preview, not nearshore · detailed forecast loading · GFS .+ \(.+ run\)$/);
  });

  test('the cold commit publishes the same phase the first render will (preview over water, hidden at a coast)', () => {
    noteColdVeilStamp({ _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND, _lastViewportBounds: OCEAN }, world(), ON());
    expect(getColdVeilState().phase).toBe('preview');
    noteColdVeilStamp({ _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND, _lastViewportBounds: COCOA }, world(), ON());
    expect(getColdVeilState().phase).toBe('hidden');
  });

  test('the strength follows __RAW_BLEND_BASE_WASH__', () => {
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(OCEAN), nowMs: 1500 }, ON({ __RAW_BLEND_BASE_WASH__: 0.5 }))).toBe(0.5);
  });

  test('the cross-fade to the detail is the veil smoothstep FROM the preview strength (never a dip to 0), 350 ms, non-blocking', () => {
    const eng = { _coldVeil: { t0: 1000 }, _landGeoJSON: LAND };
    expect(applyColdVeil(eng, { ...opts(OCEAN), nowMs: 1500 }, ON())).toBeCloseTo(0.72, 9);
    const detail = opts(OCEAN, world(), { residentCoarseGlobal: false });
    expect(applyColdVeil(eng, { ...detail, nowMs: 2000 }, ON())).toBeCloseTo(0.72, 9);          // lift frame: from the preview
    expect(getColdVeilState().phase).toBeNull();                                               // the detail is what is drawn now
    expect(applyColdVeil(eng, { ...detail, nowMs: 2175 }, ON())).toBeCloseTo(0.72 + 0.28 * 0.5, 6);
    expect(applyColdVeil(eng, { ...detail, nowMs: 2350 }, ON())).toBe(1);
    expect(eng._coldVeil).toBeNull();
  });

  test('a grace lift (no detail ever came) fades the coarse field up from the preview, not from 0', () => {
    const eng = { _coldVeil: { t0: 1000 }, _landGeoJSON: LAND };
    applyColdVeil(eng, { ...opts(OCEAN), nowMs: 4900 }, ON());
    expect(applyColdVeil(eng, { ...opts(OCEAN), nowMs: 5001 }, ON())).toBeCloseTo(0.72, 9);
    expect(eng._coldVeil.reason).toBe('grace');
  });
});

describe('never nearshore truth: suppressed near a coast', () => {
  test('inside a pilot box (Cocoa z9): no preview; the blank veil and "Loading the detailed forecast…" stay', () => {
    expect(previewCoastal(world(), COCOA, {}, LAND)).toBe('pilot_box');
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(COCOA), nowMs: 1500 }, ON())).toBe(0);
    expect(getColdVeilState().phase).toBe('hidden');
  });

  test('a land / no-data node of the coarse grid within one cell of the view suppresses it too', () => {
    const island = world((lat, lng) => lat === 32 && lng === -50);   // a node 1.6 deg north of the view
    expect(previewCoastal(island, OCEAN, {}, LAND)).toBe('land_node');
    expect(previewCoastal(world((lat, lng) => lat === 36 && lng === -50), OCEAN, {}, LAND)).toBeNull();   // > one cell away: open water
  });

  test("the owner's A/B lever __RAW_COLD_PREVIEW_COAST__ = 'show' paints it at Cocoa too", () => {
    expect(previewCoastal(world(), COCOA, { __RAW_COLD_PREVIEW_COAST__: 'show' }, LAND)).toBeNull();
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(COCOA), nowMs: 1500 }, ON({ __RAW_COLD_PREVIEW_COAST__: 'show' }))).toBeCloseTo(0.72, 9);
  });

  test("Baja z8 (Bahia Magdalena, outside every pilot box): the coastline of the map's own land suppresses it", () => {
    const BAJA = [-113.2, 24.1, -111.8, 24.9];
    expect(previewCoastal(world(), BAJA, {}, LAND)).toBe('coastline');                    // the real 2-deg frame has no land node there
    expect(applyColdVeil({ _coldVeil: { t0: 1000 }, _landGeoJSON: LAND }, { ...opts(BAJA), nowMs: 1500 }, ON())).toBe(0);
    expect(getColdVeilState().phase).toBe('hidden');
  });

  test('the Outer Banks z9: suppressed (its pilot box first; its coastline alone would too)', () => {
    const OBX = [-76.2, 35.0, -75.0, 35.8];
    expect(previewCoastal(world(), OBX, {}, LAND)).toBe('pilot_box');
    expect(coastInBox(LAND, [OBX[0] - 2, OBX[1] - 2, OBX[2] + 2, OBX[3] + 2])).toBe(true);
  });

  test('open water shows it: the mid-Atlantic and the mid-Pacific have no coast within one cell', () => {
    expect(previewCoastal(world(), OCEAN, {}, LAND)).toBeNull();
    expect(previewCoastal(world(), [-140.7, 29.6, -139.3, 30.4], {}, LAND)).toBeNull();
  });

  test('no land data yet: fail closed (the blank veil and its words), never a coast guess', () => {
    expect(previewCoastal(world(), OCEAN, {}, null)).toBe('no_land_data');
    expect(applyColdVeil({ _coldVeil: { t0: 1000 } }, { ...opts(OCEAN), nowMs: 1500 }, ON())).toBe(0);
  });

  test('decided once per cold commit (the stamp), not per frame; a pan during the veil re-decides', () => {
    const eng = { _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND, _lastViewportBounds: OCEAN };
    const n0 = coastTestCount();
    noteColdVeilStamp(eng, world(), ON());
    for (let i = 0; i < 30; i++) applyColdVeil(eng, { ...opts(OCEAN), nowMs: eng._coldVeil.t0 + 16 * i }, ON());
    expect(coastTestCount() - n0).toBe(1);
    applyColdVeil(eng, { ...opts([-45.6, 29.6, -44.4, 30.4]), nowMs: eng._coldVeil.t0 + 600 }, ON());
    expect(coastTestCount() - n0).toBe(2);
  });

  test('an antimeridian-crossing view is tested on both sides', () => {
    expect(previewCoastal(world(), [175, -20, -175, -14], {}, NO_LAND)).toBeNull();
    expect(previewCoastal(world((lat, lng) => lat === -16 && lng === -176), [175, -20, -175, -14], {}, NO_LAND)).toBe('land_node');
  });
});

describe('the status line says what the preview is', () => {
  beforeEach(() => { jest.useFakeTimers('modern'); jest.setSystemTime(Date.parse('2026-11-01T16:20:00Z')); _resetMarineDrawnForTest(); });
  afterEach(() => { jest.useRealTimers(); delete window.__RAW_DISABLE_COLD_PREVIEW__; });
  test.each(['light', 'dark', 'beach'])('%s: the coarse preview words (polite, busy), with model, valid time and run; none when killed', (theme) => {
    render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme={theme} />);
    act(() => { applyColdVeil({ _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND }, opts(OCEAN), window); });
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent(/Coarse 2° preview, not nearshore · detailed forecast loading · GFS/);
    expect(line).toHaveTextContent(/run\)$/);
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line).toHaveAttribute('data-cold-veil', 'preview');
    window.__RAW_DISABLE_COLD_PREVIEW__ = true;
    act(() => { clearColdVeil(); });
    act(() => { applyColdVeil({ _coldVeil: { t0: performance.now() }, _landGeoJSON: LAND }, opts(OCEAN), window); });
    expect(screen.getByRole('status')).toHaveTextContent('Loading the detailed forecast…');
  });
});

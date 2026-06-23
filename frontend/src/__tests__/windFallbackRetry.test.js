/**
 * windFallbackRetry.test.js
 *
 * Regression guard for the wind-heatmap "blank for 5 minutes on a transient error" bug.
 *
 * Root cause: on a transient backend wind error (504 / cold ingestion) fetchWindData
 * (windController.js) returns a synthesized safe-zero fallback grid — a SINGLE vector with
 * `renderable: false`. WeatherEngine's primary fetch loop accepted any `vectors.length > 0`
 * result as success, so it committed that non-renderable grid (which clearBuffers→blanks the
 * wind heatmap in WebGLWindLayer) AND reset the retry counter, scheduling only the lazy 5-min
 * refresh. A retry seconds later would have succeeded, but wind stayed blank for minutes.
 *
 * Fix: the commit/success guard requires renderability (`isCommittableWindGrid`). The fallback
 * now falls into the bounded fast-retry/hold path — self-healing within the RETRY_DELAYS window
 * (and holding the last good frame) exactly like an empty response already did.
 */
import { isCommittableWindGrid } from '../components/map/WeatherEngine';

// Mirror of the safe-zero fallback shape returned by windController.fetchWindData on error.
const makeFallback = (bounds = { west: -85, south: 24, east: -79, north: 31 }) => ({
  vectors: [{
    lat: (bounds.south + bounds.north) / 2,
    lng: (bounds.west + bounds.east) / 2,
    speed: 0, direction: 0, u: 0, v: 0,
  }],
  bounds,
  cols: 1,
  rows: 1,
  stale: true,
  source: 'EURO',
  hourOffset: 240,
  renderable: false,
  nonzeroCount: 0,
});

const makeGoodGrid = () => ({
  vectors: [{ lat: 27, lng: -82, speed: 12, direction: 180, u: 0, v: -12 }],
  cols: 9, rows: 9,
  bounds: { west: -85, south: 24, east: -79, north: 31 },
  renderable: true,
  nonzeroCount: 1,
});

describe('isCommittableWindGrid', () => {
  it('REJECTS the single-vector non-renderable safe-zero fallback (the bug)', () => {
    // length-1 vectors used to pass `vectors.length > 0`; renderable:false must veto it.
    expect(isCommittableWindGrid(makeFallback())).toBe(false);
  });

  it('rejects an empty (zero-vector) response', () => {
    expect(isCommittableWindGrid({ vectors: [], renderable: false })).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(isCommittableWindGrid(null)).toBe(false);
    expect(isCommittableWindGrid(undefined)).toBe(false);
  });

  it('rejects an explicitly non-renderable grid even with many vectors', () => {
    expect(isCommittableWindGrid({ vectors: [{}, {}, {}], renderable: false })).toBe(false);
  });

  it('ACCEPTS a genuine renderable wind grid', () => {
    expect(isCommittableWindGrid(makeGoodGrid())).toBe(true);
  });

  it('ACCEPTS a grid with vectors when renderable is unset (cache-extracted frames)', () => {
    // extractWindAtOffset frames may omit `renderable`; only an explicit false is a veto.
    expect(isCommittableWindGrid({ vectors: [{ lat: 1, lng: 1, speed: 5 }] })).toBe(true);
  });
});

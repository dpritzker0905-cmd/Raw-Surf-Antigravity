/**
 * #10 WARM-COMMIT COVERAGE GUARD — Source 2 (handleCooldownFallback, 2026-07-21).
 *
 * The 429 cooldown fallback reuses a cached grid from getModelSafeMarine and commits it on
 * vectors.length alone. getModelSafeMarine's per_model_hour_cache_nearest lane (marineController.js
 * :456-471) returns a nearest-HOUR grid with NO containment check (flagged __staleHour), so a
 * non-covering tile for another region could paint a floating rectangle during the cooldown. The
 * guard reuses a grid only if it COVERS the viewport while zoomed IN. These tests pin every branch.
 */
import { handleCooldownFallback } from './useMarineDataFetcherHelpers';

// A 4x4deg zoomed-in viewport over Florida.
const VP = { west: -84, south: 25, east: -80, north: 29 };
const COVERING = { grid: { vectors: [{ speed: 1 }], bounds: { west: -90, south: 20, east: -74, north: 34 } } };
const NON_COVERING = { grid: { vectors: [{ speed: 1 }], bounds: { west: -70, south: 25, east: -60, north: 35 } }, __staleHour: true };
const GLOBAL = { grid: { vectors: [{ speed: 1 }], bounds: { west: -180, south: -80, east: 180, north: 85 } } };

function run({ cached, zoom = 9, vp = VP, hasPrev = true }) {
  const commits = [];
  let prevState = hasPrev
    ? { grid: { vectors: [{ speed: 2 }], bounds: { west: -90, south: 20, east: -74, north: 34 } } }
    : null;
  const mapInstance = {
    getZoom: () => zoom,
    getBounds: () => ({ getWest: () => vp.west, getSouth: () => vp.south, getEast: () => vp.east, getNorth: () => vp.north }),
  };
  handleCooldownFallback({
    mapInstance,
    model: 'GFS',
    layer: 'waves',
    timeOffset: 0,
    timeOffsetRef: { current: 0 },
    setMarineData: (u) => { const v = typeof u === 'function' ? u(prevState) : u; commits.push(v); if (typeof u === 'function') prevState = v; },
    lastCommittedSigRef: { current: null },
    marineRevision: { current: 0 },
    getViewportHash: () => 'vp',
    logPipelineEventHelper: () => {},
    cooldownRetryRef: { current: null },
    consecutiveFailuresRef: { current: 0 },
    clearTimeoutFunc: () => {},
    getModelSafeMarine: () => cached,
    _marineDataSignature: (d) => (d ? 'sig-' + (d.grid?.bounds?.west ?? 'x') : null),
    getSharedValidTime: () => null,
  });
  return { commits, committedCached: commits.includes(cached) };
}

describe('handleCooldownFallback #10 coverage guard (Source 2)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MARINE_WARM_COVERAGE__; delete window.__MARINE_WARM_COVER_REJECT__; });

  it('zoomed IN + a COVERING cached grid still reuses it (no regression)', () => {
    const { committedCached } = run({ cached: COVERING, zoom: 9 });
    expect(committedCached).toBe(true);
  });

  it('zoomed IN + a NON-COVERING nearest-hour tile is NOT reused (the floating rectangle)', () => {
    const { committedCached } = run({ cached: NON_COVERING, zoom: 9 });
    expect(committedCached).toBe(false);
    expect(window.__MARINE_WARM_COVER_REJECT__?.count).toBe(1);
    expect(window.__MARINE_WARM_COVER_REJECT__?.last?.source).toBe('cooldown_fallback');
  });

  it('a GLOBAL grid is always reused (covers everything)', () => {
    const { committedCached } = run({ cached: GLOBAL, zoom: 9 });
    expect(committedCached).toBe(true);
  });

  it('zoomed OUT + a non-covering regional grid is reused unchanged (legacy behaviour preserved)', () => {
    const { committedCached } = run({ cached: NON_COVERING, zoom: 3 });
    expect(committedCached).toBe(true);
    expect(window.__MARINE_WARM_COVER_REJECT__).toBeUndefined();
  });

  it('a wide viewport (span > 15deg) counts as zoomed OUT and reuses a non-covering grid', () => {
    const wide = { west: -100, south: 10, east: -60, north: 45 }; // 40deg wide
    const { committedCached } = run({ cached: NON_COVERING, zoom: 9, vp: wide });
    expect(committedCached).toBe(true);
  });

  it('kill switch forces legacy reuse of a non-covering grid (clean A/B)', () => {
    window.__RAW_DISABLE_MARINE_WARM_COVERAGE__ = true;
    const { committedCached } = run({ cached: NON_COVERING, zoom: 9 });
    expect(committedCached).toBe(true);
    expect(window.__MARINE_WARM_COVER_REJECT__).toBeUndefined();
  });

  it('rejecting a non-covering grid preserves prior data as stale, never blanks when prev exists', () => {
    const { commits, committedCached } = run({ cached: NON_COVERING, zoom: 9, hasPrev: true });
    expect(committedCached).toBe(false);
    const last = commits[commits.length - 1];
    expect(last).toBeTruthy();
    expect(last.stale).toBe(true); // prior covering frame retained, marked stale
  });
});

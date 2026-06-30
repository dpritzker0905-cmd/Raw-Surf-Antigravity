import { releaseStaleMarineLock, MARINE_FETCH_LEASE_MS, MARINE_FETCH_HARD_LEASE_MS } from '../components/map/useMarineDataFetcherCore';

// Watchdog that heals the stranded marine fetch-lock wedge (see marine-stranded-fetch-lock-wedge):
// a superseded fetch can leave locks.isFetching=true forever, and the same-target dedup then skips
// every recovery fetch → permanent blank heatmap until a scrub/pan releases it.

function makeController({ aborted = false } = {}) {
  return {
    aborted: false,
    signal: { aborted },
    abort() { this.aborted = true; this.signal.aborted = true; },
  };
}

describe('releaseStaleMarineLock (stranded fetch-lock watchdog)', () => {
  const realGov = global.window && window.__MARINE_GOVERNOR_STATE__;
  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.__MARINE_GOVERNOR_STATE__ = realGov;
      window.__MARINE_FETCH_PENDING__ = undefined;
      window.__MARINE_FETCH_DEBOUNCING__ = undefined;
    }
  });

  const idleGov = () => ({ activeGridFetches: 0, activeCopernicusFetches: 0, inFlightKeys: [] });

  it('no-ops when no fetch is in flight', () => {
    const locks = { isFetching: false, fetchStartedAt: 0 };
    expect(releaseStaleMarineLock(locks, { current: null })).toBe(false);
    expect(locks.isFetching).toBe(false);
  });

  it('no-ops for a healthy in-flight fetch (within lease)', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    const locks = { isFetching: true, fetchStartedAt: Date.now() - 1000, activeSource: 'manual' };
    const ctrl = makeController();
    expect(releaseStaleMarineLock(locks, { current: ctrl })).toBe(false);
    expect(locks.isFetching).toBe(true); // untouched
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('does NOT abort a real slow fetch (lease expired but governor shows activity)', () => {
    window.__MARINE_GOVERNOR_STATE__ = { activeGridFetches: 1, activeCopernicusFetches: 0, inFlightKeys: ['k'] };
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LEASE_MS + 5000), activeSource: 'manual' };
    const ctrl = makeController();
    expect(releaseStaleMarineLock(locks, { current: ctrl })).toBe(false);
    expect(locks.isFetching).toBe(true); // a real fetch must keep running
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('still defers to a real slow fetch under the HARD lease (lease+5s, governor active) → no heal', () => {
    window.__MARINE_GOVERNOR_STATE__ = { activeGridFetches: 1, activeCopernicusFetches: 0, inFlightKeys: ['k'] };
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LEASE_MS + 5000), activeSource: 'manual' };
    const ctrl = makeController();
    expect(releaseStaleMarineLock(locks, { current: ctrl })).toBe(false);
    expect(locks.isFetching).toBe(true);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('heals a DOUBLY-stranded lock past the HARD lease even when the governor still shows activity (provably dead)', () => {
    // The wedge: a stranded fetch leaves BOTH locks.isFetching=true AND the governor counters set, so govIdle
    // never clears. Past the hard lease the lock is provably dead and must heal regardless of the governor.
    window.__MARINE_GOVERNOR_STATE__ = { activeGridFetches: 1, activeCopernicusFetches: 0, inFlightKeys: ['k'] };
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_HARD_LEASE_MS + 1000), activeSource: 'manual' };
    const ctrl = makeController();
    expect(releaseStaleMarineLock(locks, { current: ctrl })).toBe(true);
    expect(locks.isFetching).toBe(false);
    expect(locks.fetchStartedAt).toBe(0);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('heals a stranded lock: lease expired + governor idle → abort, clear, return true', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour: 0 };
    window.__MARINE_FETCH_DEBOUNCING__ = true;
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LEASE_MS + 1000), activeSource: 'manual' };
    const ctrl = makeController();

    expect(releaseStaleMarineLock(locks, { current: ctrl })).toBe(true);
    expect(locks.isFetching).toBe(false);
    expect(locks.fetchStartedAt).toBe(0);
    expect(locks.activeSource).toBe(null);
    expect(ctrl.signal.aborted).toBe(true);
    expect(window.__MARINE_FETCH_PENDING__).toBe(null);
    expect(window.__MARINE_FETCH_DEBOUNCING__).toBe(false);
  });
});

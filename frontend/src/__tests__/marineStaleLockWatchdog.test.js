import { releaseStaleMarineLock, MARINE_FETCH_LEASE_MS, MARINE_FETCH_HARD_LEASE_MS, MARINE_FETCH_LIVE_CEILING_MS } from '../components/map/useMarineDataFetcherCore';

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
      window.__MARINE_LOCK_LIVE_EXTENDED__ = undefined;
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

  it('does NOT abort a live BACKEND-redirect fetch (governor idle, but the in-flight registry shows a live foreground entry)', () => {
    // Backend-redirect grid fetches (fetchBackendMarineGrid etc.) never register in the governor,
    // so govIdle reads true while one is live. On a slow backend the old code aborted the live
    // fetch every lease period — the 2026-07-04 "Stale fetch lock released → signal is aborted"
    // kill/refetch loop. The registry's foreground entry is the live-fetch signal.
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LEASE_MS + 5000), activeSource: 'manual' };
    const ctrl = makeController();
    ctrl.__intent = { model: 'GFS', rawModel: 'GFS', layer: 'waves', hour: 0, boundsKey: 'k' };
    const inFlight = { find: (intent) => ({ key: 'k', state: 'foreground', controller: ctrl, intent }) };
    expect(releaseStaleMarineLock(locks, { current: ctrl }, inFlight)).toBe(false);
    expect(locks.isFetching).toBe(true);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('EXTENDS the lease past the HARD lease when the registry entry is live (2026-07-06 abort-loop fix: a real cold-backend series fetch measured 40.7s — killing it at 25s looped forever)', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_HARD_LEASE_MS + 1000), activeSource: 'manual' };
    const ctrl = makeController();
    ctrl.__intent = { model: 'EURO', rawModel: 'EURO', layer: 'waves', hour: 0, boundsKey: 'k' };
    const inFlight = { find: (intent) => ({ key: 'k', state: 'foreground', controller: ctrl, intent }) };
    expect(releaseStaleMarineLock(locks, { current: ctrl }, inFlight)).toBe(false);
    expect(locks.isFetching).toBe(true);   // live slow fetch keeps running
    expect(ctrl.signal.aborted).toBe(false);
    expect(window.__MARINE_LOCK_LIVE_EXTENDED__ && window.__MARINE_LOCK_LIVE_EXTENDED__.count).toBeGreaterThan(0);
  });

  it('still heals past the ABSOLUTE ceiling even with a live-looking registry entry (bounded zombie-hang recovery)', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LIVE_CEILING_MS + 1000), activeSource: 'manual' };
    const ctrl = makeController();
    ctrl.__intent = { model: 'GFS', rawModel: 'GFS', layer: 'waves', hour: 0, boundsKey: 'k' };
    const inFlight = { find: (intent) => ({ key: 'k', state: 'foreground', controller: ctrl, intent }) };
    expect(releaseStaleMarineLock(locks, { current: ctrl }, inFlight)).toBe(true);
    expect(locks.isFetching).toBe(false);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('kill switch __RAW_DISABLE_LOCK_LIVE_EXTEND__ restores the old hard-lease heal for a live entry', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    window.__RAW_DISABLE_LOCK_LIVE_EXTEND__ = true;
    try {
      const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_HARD_LEASE_MS + 1000), activeSource: 'manual' };
      const ctrl = makeController();
      ctrl.__intent = { model: 'GFS', rawModel: 'GFS', layer: 'waves', hour: 0, boundsKey: 'k' };
      const inFlight = { find: (intent) => ({ key: 'k', state: 'foreground', controller: ctrl, intent }) };
      expect(releaseStaleMarineLock(locks, { current: ctrl }, inFlight)).toBe(true);
      expect(locks.isFetching).toBe(false);
      expect(ctrl.signal.aborted).toBe(true);
    } finally {
      delete window.__RAW_DISABLE_LOCK_LIVE_EXTEND__;
    }
  });

  it('heals when the registry entry belongs to a DIFFERENT controller (the lock really is stranded)', () => {
    window.__MARINE_GOVERNOR_STATE__ = idleGov();
    const locks = { isFetching: true, fetchStartedAt: Date.now() - (MARINE_FETCH_LEASE_MS + 1000), activeSource: 'manual' };
    const ctrl = makeController();
    ctrl.__intent = { model: 'GFS', rawModel: 'GFS', layer: 'waves', hour: 0, boundsKey: 'k' };
    const otherCtrl = makeController();
    const inFlight = { find: (intent) => ({ key: 'k', state: 'foreground', controller: otherCtrl, intent }) };
    expect(releaseStaleMarineLock(locks, { current: ctrl }, inFlight)).toBe(true);
    expect(locks.isFetching).toBe(false);
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

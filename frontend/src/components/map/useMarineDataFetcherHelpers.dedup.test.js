/**
 * Commit dedup must key on what React state ACTUALLY holds, not the side ledger (2026-07-03).
 * Live wedge ×2 tonight: the no-downgrade guard (racing a stale engine _lastZoom) rejected a coarse
 * commit AFTER the ledger recorded its signature — every retry then hit duplicate_commit_skipped
 * while the display held a different grid (stranded 3° regional at band zoom; 3Hz commit loop ran
 * 40 minutes). prev's own signature cannot diverge from state by construction.
 */
import { commitMarineData } from './useMarineDataFetcherHelpers';
import { _marineDataSignature } from './useMarineOrchestratorDiag';

function makeMarineData(id, cols, rows) {
  const vectors = Array.from({ length: cols * rows }, (_, i) => ({
    lat: Math.floor(i / cols), lng: i % cols, u: 0.1 * (id + 1), v: 0.2, speed: 1 + id, direction: 90,
  }));
  return {
    hourOffset: 0,
    grid: {
      vectors, cols, rows,
      bounds: { west: -180, south: -80, east: 180, north: 85 },
      __sourceModel: 'GFS', __componentLayer: 'waves', __provider: 'open-meteo',
      renderable: true,
    },
  };
}

function runCommit(data, prevState, lastCommittedSigRef) {
  let committed = null;
  let events = [];
  const noop = () => {};
  commitMarineData({
    data,
    bounds: null,
    model: 'GFS',
    layer: 'waves',
    timeOffset: 0,
    timeOffsetRef: { current: 0 },
    setMarineData: (updater) => { committed = typeof updater === 'function' ? updater(prevState) : updater; },
    lastCommittedSigRef,
    marineRevision: { current: 0 },
    getViewportHash: () => 'vp',
    logPipelineEventHelper: (type, detail) => events.push({ type, detail }),
    consecutiveFailuresRef: { current: 0 },
    isCommittingDataRef: { current: false },
    isInternalMapUpdateRef: { current: false },
    internalUpdateTimerRef: { current: null },
    locks: {},
    source: 'test',
    scheduleSWRRevalidation: noop,
    updateMarineGrid: noop,
    getBackendCopernicusFlag: () => false,
    getBackendIconMarineFlag: () => false,
    getBackendWeatherFlag: () => false,
    _marineDataSignature,
    getSharedValidTime: () => null,
    updateDeprecationDiag: noop,
    setTimeoutFunc: () => 0,
    clearTimeoutFunc: noop,
  });
  return { committed, events };
}

describe('commitMarineData duplicate detection (state-authoritative, 2026-07-03)', () => {
  it('COMMITS when the ledger holds the incoming sig but state holds a DIFFERENT grid (the wedge)', () => {
    const coarse = makeMarineData(0, 37, 17);
    const regional = makeMarineData(1, 13, 13);
    // The wedge state: ledger says the coarse was committed (an engine-rejected commit recorded it),
    // but React state actually holds the regional.
    const ledger = { current: _marineDataSignature(coarse, 'waves') };
    const { committed, events } = runCommit(coarse, regional, ledger);
    expect(committed).toBe(coarse);
    expect(committed.__commitRevision).toBe(1);
    expect(events.some(e => e.type === 'duplicate_commit_skipped')).toBe(false);
  });

  it('SKIPS a true duplicate (state holds this exact product AND the ledger agrees)', () => {
    const coarse = makeMarineData(0, 37, 17);
    const prev = makeMarineData(0, 37, 17); // identical content → identical signature
    const ledger = { current: _marineDataSignature(prev, 'waves') };
    const { committed, events } = runCommit(coarse, prev, ledger);
    expect(committed).toBe(prev);
    expect(events.some(e => e.type === 'duplicate_commit_skipped')).toBe(true);
  });

  it('COMMITS an identical product after a ledger invalidation (the §2b/toggle recovery hatch)', () => {
    // Recovery paths (engine-empty, toggle re-feed, model switch) null the ledger to FORCE the next
    // commit through even when the re-fetched product is content-identical to state — the engine may
    // have lost its texture while React state retained the data, and only a fresh __commitRevision
    // re-fires the upload effect.
    const coarse = makeMarineData(0, 37, 17);
    const prev = makeMarineData(0, 37, 17);
    const ledger = { current: null }; // invalidated
    const { committed, events } = runCommit(coarse, prev, ledger);
    expect(committed).toBe(coarse);
    expect(committed.__commitRevision).toBe(1);
    expect(events.some(e => e.type === 'duplicate_commit_skipped')).toBe(false);
  });

  it('stamps __committedSig on commit so the next dedup reads prev without rehashing', () => {
    const coarse = makeMarineData(0, 37, 17);
    const ledger = { current: null };
    const { committed } = runCommit(coarse, null, ledger);
    expect(committed.__committedSig).toBe(_marineDataSignature(coarse, 'waves'));
    expect(ledger.current).toBe(committed.__committedSig);
  });
});

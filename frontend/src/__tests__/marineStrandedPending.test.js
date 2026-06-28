import {
  evaluateStrandedPending,
  MARINE_PENDING_LEASE_MS,
  STRANDED_PENDING_RECORD_MS,
} from '../components/map/useMarineScrubSettle';

// Symmetric sibling of releaseStaleMarineLock (see marine-stranded-fetch-lock-wedge): a __MARINE_FETCH_PENDING__
// stuck non-null while isFetching is FALSE and the governor is idle wedges BOTH frontend recovery paths
// (runScrubSettleCheck bypasses on a matching pending; the blank-backstop requires !pending) and the
// isFetching-gated watchdog can't see it → the heatmap freezes until a manual layer toggle. This pure
// decision function drives the backstop's govIdle-guarded clear+redrive, so a false positive is impossible.

describe('evaluateStrandedPending (stranded fetch-pending watchdog)', () => {
  const base = { hasPending: true, pendingAgeMs: MARINE_PENDING_LEASE_MS + 1000, govIdle: true, isFetching: false };

  it('no-ops entirely when there is no pending', () => {
    expect(evaluateStrandedPending({ ...base, hasPending: false })).toEqual({ record: false, stranded: false });
  });

  it('does NOT strand a fresh pending (within the lease)', () => {
    const r = evaluateStrandedPending({ ...base, pendingAgeMs: 500 });
    expect(r.stranded).toBe(false);
    expect(r.record).toBe(false); // also under the record threshold
  });

  it('records (but does not strand) once a pending out-lives a normal fetch, before the lease', () => {
    // Past the record threshold (3s) but NOT yet past the lease (6s) → snapshot only, no clear.
    const r = evaluateStrandedPending({ ...base, pendingAgeMs: STRANDED_PENDING_RECORD_MS + 100, govIdle: true, isFetching: false });
    expect(r.record).toBe(true);
    expect(r.stranded).toBe(false);
  });

  it('records but never strands while the governor is BUSY (a real slow fetch must keep running)', () => {
    const r = evaluateStrandedPending({ ...base, govIdle: false });
    expect(r.record).toBe(true);    // still worth a forensic snapshot
    expect(r.stranded).toBe(false); // but never cleared — a live fetch backs this pending
  });

  it('records but never strands while isFetching is held (that is releaseStaleMarineLock’s job)', () => {
    const r = evaluateStrandedPending({ ...base, isFetching: true });
    expect(r.record).toBe(true);
    expect(r.stranded).toBe(false);
  });

  it('strands a provably-dead pending: past lease + governor idle + not isFetching', () => {
    const r = evaluateStrandedPending(base);
    expect(r.stranded).toBe(true);
  });

  it('records between the record threshold and the lease, without stranding yet', () => {
    const mid = (STRANDED_PENDING_RECORD_MS + MARINE_PENDING_LEASE_MS) / 2;
    const r = evaluateStrandedPending({ ...base, pendingAgeMs: mid });
    expect(r.record).toBe(true);
    expect(r.stranded).toBe(false);
  });

  it('exposes a pending lease strictly longer than the record threshold', () => {
    expect(MARINE_PENDING_LEASE_MS).toBeGreaterThan(STRANDED_PENDING_RECORD_MS);
  });
});

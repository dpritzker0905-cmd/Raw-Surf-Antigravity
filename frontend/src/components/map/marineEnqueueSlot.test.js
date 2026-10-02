/**
 * The capability-aware dispatch slot (2026-10-01, audit F-23; marineEnqueueSlot.js): what each enqueue does against the slot, in
 * every state the slot can be in. The call-site tests (useMarineDataFetcherCore.enqueueSlot.test.js) drive the same rules through
 * the real enqueueMarineUpdate with fake timers.
 */
import { slotVerdict, claimEnqueueSlot, isCacheOnlySource } from './marineEnqueueSlot';
import { forensicDump, forensicReset } from './marineForensics';

const CACHE_SLOT = { cacheOnly: true };
const FETCH_SLOT = { cacheOnly: false };

afterEach(() => { delete window.__RAW_DISABLE_SU_NO_CANCEL__; forensicReset(); });

describe('isCacheOnlySource', () => {
  it('is true for the series-arrival lane and for nothing else the fetcher enqueues', () => {
    expect(isCacheOnlySource('series_upgrade')).toBe(true);
    ['moveend', 'manual', 'mount', 'load', 'flavor_toggle', 'timeline_scrub', 'detached_wake', 'abort_recovery_retry',
      'moveend_pending', 'series_upgrade_pending'].forEach((s) => expect(isCacheOnlySource(s)).toBe(false));
  });
});

describe('slotVerdict: a fetch-capable enqueue', () => {
  it.each([
    ['the slot is free and nothing is pending', false, false, 'schedule'],
    ['a dispatched run is waiting out its stable delay (it replaces that run, as before)', false, true, 'schedule'],
    ['the slot is held by another fetch-capable enqueue (the first one does the work, as before)', FETCH_SLOT, false, 'drop'],
    ['the slot is held by a fetch-capable enqueue and a timer is armed', FETCH_SLOT, true, 'drop'],
    ['the slot is held by a CACHE-ONLY enqueue (it supersedes it: the dropped fetch was the defect)', CACHE_SLOT, false, 'supersede'],
    ['the slot is held by a cache-only enqueue and a timer is armed', CACHE_SLOT, true, 'supersede'],
  ])('%s -> %s', (_why, held, armed, verdict) => {
    expect(slotVerdict('moveend', held, armed)).toBe(verdict);
  });
});

describe('slotVerdict: the cache-only lane', () => {
  it.each([
    ['the slot is free and nothing is pending', false, false, 'schedule'],
    ['a dispatched run is waiting out its stable delay (it must not cancel it: the defect)', false, true, 'skip'],
    ['the slot is held by a fetch-capable enqueue', FETCH_SLOT, false, 'skip'],
    ['the slot is held by another cache-only enqueue', CACHE_SLOT, false, 'skip'],
    ['the slot is held and a timer is armed', CACHE_SLOT, true, 'skip'],
  ])('%s -> %s', (_why, held, armed, verdict) => {
    expect(slotVerdict('series_upgrade', held, armed)).toBe(verdict);
  });
});

describe('slotVerdict: the kill switch restores the previous slot exactly', () => {
  it.each([
    ['moveend', false, false, 'schedule'],
    ['moveend', false, true, 'schedule'],
    ['moveend', FETCH_SLOT, false, 'drop'],
    ['moveend', CACHE_SLOT, false, 'drop'],     // the second hole: a fetch dropped by a cache-only slot
    ['series_upgrade', false, false, 'schedule'],
    ['series_upgrade', false, true, 'schedule'], // the first hole: the lane replaces a pending fetch
    ['series_upgrade', CACHE_SLOT, false, 'drop'],
    ['series_upgrade', FETCH_SLOT, true, 'drop'],
  ])('%s, held=%j, armed=%s -> %s', (source, held, armed, verdict) => {
    expect(slotVerdict(source, held, armed, true)).toBe(verdict);
  });
});

describe('claimEnqueueSlot', () => {
  const refs = (held = false, timer = null) => ({ scheduledRef: { current: held }, timeoutIdRef: { current: timer } });
  const events = (type) => forensicDump().events.filter((e) => e.type === type);

  it('takes a free slot and records which kind of enqueue holds it', () => {
    const r = refs();
    const slot = claimEnqueueSlot('moveend', r.scheduledRef, r.timeoutIdRef);
    expect(slot).toEqual({ cacheOnly: false });
    expect(r.scheduledRef.current).toBe(slot);
    const lane = refs();
    expect(claimEnqueueSlot('series_upgrade', lane.scheduledRef, lane.timeoutIdRef)).toEqual({ cacheOnly: true });
    expect(lane.scheduledRef.current.cacheOnly).toBe(true);
  });

  it('skips the lane while a run is pending, leaves the slot and the timer alone, and says so in the forensic ring', () => {
    const r = refs(false, 7);
    expect(claimEnqueueSlot('series_upgrade', r.scheduledRef, r.timeoutIdRef)).toBeNull();
    expect(r.scheduledRef.current).toBe(false);
    expect(r.timeoutIdRef.current).toBe(7);
    expect(events('series_upgrade_skipped_pending')).toEqual([expect.objectContaining({ slotted: false })]);
    const held = refs(FETCH_SLOT);
    expect(claimEnqueueSlot('series_upgrade', held.scheduledRef, held.timeoutIdRef)).toBeNull();
    expect(held.scheduledRef.current).toBe(FETCH_SLOT);
    expect(events('series_upgrade_skipped_pending')[1]).toEqual(expect.objectContaining({ slotted: true }));
  });

  it('supersedes a cache-only slot with a NEW slot (the old dispatch will find another slot there) and records it', () => {
    const r = refs(CACHE_SLOT);
    const slot = claimEnqueueSlot('moveend', r.scheduledRef, r.timeoutIdRef);
    expect(slot).toEqual({ cacheOnly: false });
    expect(slot).not.toBe(CACHE_SLOT);
    expect(r.scheduledRef.current).toBe(slot);
    expect(events('cache_only_slot_superseded')).toEqual([expect.objectContaining({ by: 'moveend' })]);
  });

  it('drops a fetch-capable enqueue behind another fetch-capable one without a forensic event, as before', () => {
    const r = refs(FETCH_SLOT);
    expect(claimEnqueueSlot('manual', r.scheduledRef, r.timeoutIdRef)).toBeNull();
    expect(r.scheduledRef.current).toBe(FETCH_SLOT);
    expect(forensicDump().events.filter((e) => /skipped_pending|superseded/.test(e.type))).toEqual([]);
  });

  it('with the kill switch it behaves as the old slot did and records nothing', () => {
    window.__RAW_DISABLE_SU_NO_CANCEL__ = true;
    const r = refs(CACHE_SLOT);
    expect(claimEnqueueSlot('moveend', r.scheduledRef, r.timeoutIdRef)).toBeNull();       // dropped
    const t = refs(false, 9);
    expect(claimEnqueueSlot('series_upgrade', t.scheduledRef, t.timeoutIdRef)).toEqual({ cacheOnly: true }); // replaces the pending run
    expect(forensicDump().events.filter((e) => /skipped_pending|superseded/.test(e.type))).toEqual([]);
  });
});

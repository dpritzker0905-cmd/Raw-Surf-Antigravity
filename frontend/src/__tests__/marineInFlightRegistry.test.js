/**
 * marineInFlightRegistry.test.js — Phase 1 (pure registry, no fetcher wiring).
 * Verifies detach-instead-of-abort mechanics + bounded cap + identity-safe completion +
 * the two safety additions agreed with the user: (1) cap eviction never strands the
 * current/wanted target, (2) a wanted detached completion reports shouldWake exactly once.
 */
import { createMarineInFlightRegistry, marineInFlightKey } from '../components/map/marineInFlightRegistry';

// Fake AbortController that records abort() calls (so we can assert "did NOT abort").
function fakeController() {
  return { aborted: false, abortCalls: 0, abort() { this.aborted = true; this.abortCalls += 1; } };
}
const intent = (over = {}) => ({ rawModel: 'ICON', model: 'ICON', layer: 'waves', hour: 0, boundsKey: 'fl', ...over });

let clock;
const reg = () => createMarineInFlightRegistry({ cap: 4, mirrorToWindow: false, now: () => ++clock });
beforeEach(() => { clock = 0; });

describe('marineInFlightKey', () => {
  it('includes rawModel, model, layer, hour, boundsKey', () => {
    expect(marineInFlightKey(intent({ rawModel: 'ICON', model: 'GFS', hour: 200, boundsKey: 'b' })))
      .toBe('ICON|GFS|waves|200|b');
  });
  it('distinguishes different bounds (no cross-viewport reuse)', () => {
    expect(marineInFlightKey(intent({ boundsKey: 'a' }))).not.toBe(marineInFlightKey(intent({ boundsKey: 'b' })));
  });
});

describe('detach instead of abort', () => {
  it('detaches a different-target request WITHOUT calling abort', () => {
    const r = reg();
    const cA = fakeController();
    r.registerForeground(cA, intent({ layer: 'waves' }), 1);
    // user switches to a different layer -> caller detaches A
    const detached = r.detach(intent({ layer: 'waves' }));
    expect(detached.state).toBe('detached');
    expect(cA.abortCalls).toBe(0); // the whole point: not aborted
  });

  it('same key + same controller is a reuse no-op (foreground_same_target_reused)', () => {
    const r = reg();
    const c = fakeController();
    r.registerForeground(c, intent(), 1);
    r.registerForeground(c, intent(), 1);
    expect(r.getTelemetry().counts.foreground_same_target_reused).toBe(1);
    expect(r.size()).toBe(1);
  });
});

describe('A -> B -> A reuse', () => {
  it('finds detached A on return and marks it wanted (no duplicate registration)', () => {
    const r = reg();
    const cA = fakeController();
    r.registerForeground(cA, intent({ layer: 'waves' }), 1);     // A foreground
    r.detach(intent({ layer: 'waves' }));                         // switch to B -> detach A
    const cB = fakeController();
    r.registerForeground(cB, intent({ layer: 'swell_1' }), 2);    // B foreground
    // user returns to A: caller checks registry BEFORE starting a network request
    const found = r.find(intent({ layer: 'waves' }));
    expect(found).toBeTruthy();
    expect(found.state).toBe('detached');
    const wanted = r.markWanted(intent({ layer: 'waves' }));
    expect(wanted).toBe(true);
    expect(cA.abortCalls).toBe(0);
  });

  it('completion of a wanted detached request reports shouldWake exactly once', () => {
    const r = reg();
    const cA = fakeController();
    r.registerForeground(cA, intent({ layer: 'waves' }), 1);
    r.detach(intent({ layer: 'waves' }));
    r.markWanted(intent({ layer: 'waves' }));
    const res = r.complete(intent({ layer: 'waves' }), cA, 'success');
    expect(res.shouldWake).toBe(true);
    expect(r.getTelemetry().counts.detached_reused_on_return).toBe(1);
    // entry removed after completion -> cannot wake twice
    expect(r.find(intent({ layer: 'waves' }))).toBeNull();
  });

  it('wakes a wanted detached request on success OR failure, but NOT on deliberate abort', () => {
    const r = reg();
    // not wanted -> no wake even on success
    const c1 = fakeController();
    r.registerForeground(c1, intent({ hour: 1 }), 1);
    r.detach(intent({ hour: 1 }));
    expect(r.complete(intent({ hour: 1 }), c1, 'success').shouldWake).toBe(false);

    // wanted + failure -> WAKE (re-fetch fresh) — stuck-proofing
    const c2 = fakeController();
    r.registerForeground(c2, intent({ hour: 2 }), 2);
    r.detach(intent({ hour: 2 }));
    r.markWanted(intent({ hour: 2 }));
    expect(r.complete(intent({ hour: 2 }), c2, 'failure').shouldWake).toBe(true);

    // wanted + abort (cap/unmount) -> no wake (but cap never aborts a wanted entry anyway)
    const c3 = fakeController();
    r.registerForeground(c3, intent({ hour: 3 }), 3);
    r.detach(intent({ hour: 3 }));
    r.markWanted(intent({ hour: 3 }));
    expect(r.complete(intent({ hour: 3 }), c3, 'abort').shouldWake).toBe(false);
  });

  it('cap evicts the oldest non-wanted, non-just-detached entry and spares the wanted one', () => {
    const r2 = createMarineInFlightRegistry({ cap: 1, mirrorToWindow: false, now: () => ++clock });
    const wanted = fakeController();
    const plainOld = fakeController();
    const trigger = fakeController();
    r2.registerForeground(wanted, intent({ hour: 1 }), 1); r2.detach(intent({ hour: 1 })); r2.markWanted(intent({ hour: 1 }));
    r2.registerForeground(plainOld, intent({ hour: 2 }), 2); r2.detach(intent({ hour: 2 }));
    r2.registerForeground(trigger, intent({ hour: 3 }), 3); r2.detach(intent({ hour: 3 })); // protect=h3 -> evicts oldest non-wanted = h2
    expect(wanted.abortCalls).toBe(0);   // wanted survives
    expect(plainOld.abortCalls).toBe(1); // non-wanted oldest evicted
    expect(trigger.abortCalls).toBe(0);  // just-detached protected
    expect(r2.find(intent({ hour: 1 }))).toBeTruthy();
  });

  it('cap evicts NOTHING when all over-cap detached entries are wanted', () => {
    const r2 = createMarineInFlightRegistry({ cap: 1, mirrorToWindow: false, now: () => ++clock });
    const a = fakeController();
    const b = fakeController();
    r2.registerForeground(a, intent({ hour: 1 }), 1); r2.detach(intent({ hour: 1 })); r2.markWanted(intent({ hour: 1 }));
    r2.registerForeground(b, intent({ hour: 2 }), 2); r2.detach(intent({ hour: 2 })); r2.markWanted(intent({ hour: 2 }));
    expect(a.abortCalls).toBe(0);
    expect(b.abortCalls).toBe(0); // temporary over-cap, neither stranded
    expect(r2.detachedCount()).toBe(2);
  });
});

describe('identity-safe completion / removal', () => {
  it('complete() is ignored when a newer controller owns the key', () => {
    const r = reg();
    const cOld = fakeController();
    const cNew = fakeController();
    r.registerForeground(cOld, intent(), 1);
    r.detach(intent());
    r.registerForeground(cNew, intent(), 2); // key re-registered with new controller
    const res = r.complete(intent(), cOld, 'success'); // stale completion
    expect(res.entry).toBeNull();
    expect(r.find(intent()).controller).toBe(cNew); // newer entry intact
  });

  it('remove() is a no-op for a stale controller', () => {
    const r = reg();
    const cOld = fakeController();
    const cNew = fakeController();
    r.registerForeground(cOld, intent(), 1);
    r.registerForeground(cNew, intent(), 2);
    expect(r.remove(intent(), cOld)).toBe(false);
    expect(r.size()).toBe(1);
    expect(r.remove(intent(), cNew)).toBe(true);
  });
});

describe('detached cap (default 4)', () => {
  it('aborts only the oldest when a 5th detached request appears', () => {
    const r = reg();
    const cs = [];
    for (let i = 0; i < 5; i++) {
      const c = fakeController();
      cs.push(c);
      r.registerForeground(c, intent({ hour: i }), i);
      r.detach(intent({ hour: i }));
    }
    // 5 detached -> cap 4 -> oldest (hour 0) aborted, rest alive
    expect(cs[0].abortCalls).toBe(1);
    expect(cs.slice(1).every(c => c.abortCalls === 0)).toBe(true);
    expect(r.detachedCount()).toBe(4);
    expect(r.getTelemetry().counts.detached_aborted_by_cap).toBe(1);
  });

  it('prefers evicting non-wanted entries and never the just-detached key', () => {
    // cap=2. Detach order: hour0 (plain, oldest), hour1 (wanted), then hour2 (just-detached,
    // protected). Eviction must skip the protected hour2 and prefer the non-wanted oldest
    // (hour0), leaving the wanted hour1 alive.
    const r2 = createMarineInFlightRegistry({ cap: 2, mirrorToWindow: false, now: () => ++clock });
    const plainOld = fakeController(); // hour 0 — oldest, non-wanted
    const wanted = fakeController();   // hour 1 — wanted
    const justDetached = fakeController(); // hour 2 — protected (the detach that triggers cap)
    r2.registerForeground(plainOld, intent({ hour: 0 }), 1); r2.detach(intent({ hour: 0 }));
    r2.registerForeground(wanted, intent({ hour: 1 }), 2); r2.detach(intent({ hour: 1 })); r2.markWanted(intent({ hour: 1 }));
    r2.registerForeground(justDetached, intent({ hour: 2 }), 3);
    r2.detach(intent({ hour: 2 })); // enforceCap(protectKey = hour2) -> evicts oldest non-wanted = hour0
    expect(plainOld.abortCalls).toBe(1);
    expect(wanted.abortCalls).toBe(0);
    expect(justDetached.abortCalls).toBe(0);
    expect(r2.find(intent({ hour: 1 }))).toBeTruthy();
    expect(r2.find(intent({ hour: 0 }))).toBeNull();
  });
});

describe('abortAll (true unmount)', () => {
  it('aborts foreground and detached and clears', () => {
    const r = reg();
    const cFg = fakeController();
    const cDet = fakeController();
    r.registerForeground(cFg, intent({ hour: 1 }), 1);
    r.registerForeground(cDet, intent({ hour: 2 }), 2);
    r.detach(intent({ hour: 2 }));
    r.abortAll();
    expect(cFg.abortCalls).toBe(1);
    expect(cDet.abortCalls).toBe(1);
    expect(r.size()).toBe(0);
    expect(r.getTelemetry().counts.detached_aborted_on_unmount).toBe(1); // only the detached one tallied
  });
});

describe('telemetry', () => {
  it('tracks distinct outcomes (not a single ambiguous "completed")', () => {
    const r = reg();
    const c1 = fakeController(); r.registerForeground(c1, intent({ hour: 1 }), 1); r.detach(intent({ hour: 1 }));
    r.complete(intent({ hour: 1 }), c1, 'success');
    const c2 = fakeController(); r.registerForeground(c2, intent({ hour: 2 }), 2); r.detach(intent({ hour: 2 }));
    r.complete(intent({ hour: 2 }), c2, 'failure');
    const t = r.getTelemetry();
    expect(t.counts.detached_cache_completed).toBe(1);
    expect(t.counts.detached_failed).toBe(1);
  });

  it('resetTelemetry clears counts and log', () => {
    const r = reg();
    const c = fakeController(); r.registerForeground(c, intent(), 1);
    r.resetTelemetry();
    expect(r.getTelemetry().counts.foreground_started).toBe(0);
    expect(r.getTelemetry().log.length).toBe(0);
  });
});

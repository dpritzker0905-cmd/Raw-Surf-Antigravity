import { marineEmptyVerdict, MARINE_EMPTY_GRACE_MS } from './marineEmptyGrace';

describe('marineEmptyVerdict (W-32: the commit gap is a load, not an empty render)', () => {
  test('the measured healthy load is never reported: flags drop at 3,037 ms, the grid commits at 3,719 ms', () => {
    // 50 ms probe on a production build, 2026-09-29: every snapshot in the gap, then the commit.
    let since = null;
    for (let t = 3037; t < 3719; t += 50) {
      const v = marineEmptyVerdict({ empty: true, transitioning: false, since, now: t });
      expect(v.report).toBe(false);
      since = v.since;
    }
    expect(since).toBe(3037);
    const committed = marineEmptyVerdict({ empty: false, transitioning: false, since, now: 3719 });
    expect(committed).toEqual({ report: false, since: null, recheckInMs: null });
  });

  test('a real empty render (no data, nothing fetching) is still reported once it holds for the grace', () => {
    const first = marineEmptyVerdict({ empty: true, transitioning: false, since: null, now: 10000 });
    expect(first).toEqual({ report: false, since: 10000, recheckInMs: MARINE_EMPTY_GRACE_MS });
    const later = marineEmptyVerdict({ empty: true, transitioning: false, since: first.since, now: 10000 + MARINE_EMPTY_GRACE_MS });
    expect(later.report).toBe(true);
    expect(later.since).toBe(10000);
  });

  test('before the grace ends it asks to be re-checked exactly when the grace would end', () => {
    const v = marineEmptyVerdict({ empty: true, transitioning: false, since: 5000, now: 6200 });
    expect(v).toEqual({ report: false, since: 5000, recheckInMs: MARINE_EMPTY_GRACE_MS - 1200 });
  });

  test('a transition resets the clock, so the next load gets a full grace', () => {
    const during = marineEmptyVerdict({ empty: true, transitioning: true, since: 1000, now: 9000 });
    expect(during).toEqual({ report: false, since: null, recheckInMs: null });
    const after = marineEmptyVerdict({ empty: true, transitioning: false, since: during.since, now: 9100 });
    expect(after.report).toBe(false);
    expect(after.since).toBe(9100);
  });

  test('present data is never a violation, whatever the clock says', () => {
    expect(marineEmptyVerdict({ empty: false, transitioning: false, since: 0, now: 1e9 }).report).toBe(false);
  });

  test('the kill switch restores the immediate report', () => {
    const v = marineEmptyVerdict({ empty: true, transitioning: false, since: null, now: 42, disabled: true });
    expect(v.report).toBe(true);
    expect(v.recheckInMs).toBeNull();
  });

  test('the grace is exactly the boundary: one millisecond short is not a report', () => {
    expect(marineEmptyVerdict({ empty: true, transitioning: false, since: 0, now: MARINE_EMPTY_GRACE_MS - 1 }).report).toBe(false);
    expect(marineEmptyVerdict({ empty: true, transitioning: false, since: 0, now: MARINE_EMPTY_GRACE_MS }).report).toBe(true);
  });
});

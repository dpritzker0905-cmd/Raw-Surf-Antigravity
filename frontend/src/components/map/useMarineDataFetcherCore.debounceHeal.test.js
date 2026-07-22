/**
 * Stranded-debounce heal (2026-07-22, hunt defect 3.3). enqueueMarineUpdate sets
 * __MARINE_FETCH_DEBOUNCING__ true before dispatch; updateMarineGrid clears it at dispatch (:486) or
 * in the finally. But a pre-dispatch early return leaves requestId=0, so the finally's
 * requestId===marineRequestIdRef.current block (a real prior fetch bumped the ref to N>0) never clears
 * it — the flag strands true and ~8 "transitioning" gates hold stale frames until a watchdog/gesture.
 * shouldHealStrandedDebounce authorizes the finally to clear it ONLY for a never-dispatched (requestId=0)
 * invocation that did not deliberately preserve the debounce (clearDebounce) when the flag is truly
 * stranded true — never for a dispatched/superseded fetch (which owns its own clear at :486).
 */
import { shouldHealStrandedDebounce } from './useMarineDataFetcherCore';

describe('shouldHealStrandedDebounce (finally-path debounce strand heal)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__; });

  it('HEALS a genuine strand: never dispatched (requestId=0), not deliberately preserved, flag stuck true', () => {
    expect(shouldHealStrandedDebounce(0, true, true)).toBe(true);
  });

  it('does NOT heal a dispatched fetch (requestId>0 already cleared the flag at dispatch)', () => {
    expect(shouldHealStrandedDebounce(5, true, true)).toBe(false);
    expect(shouldHealStrandedDebounce(1, true, true)).toBe(false);
  });

  it('does NOT heal a path that deliberately preserved the debounce (clearDebounce=false → a re-drive is pending)', () => {
    // isMoving/isZooming, detached-dedup, degenerate+retry set clearDebounce=false to keep the window.
    expect(shouldHealStrandedDebounce(0, false, true)).toBe(false);
  });

  it('is a no-op when the flag is not actually stranded (already false)', () => {
    expect(shouldHealStrandedDebounce(0, true, false)).toBe(false);
    expect(shouldHealStrandedDebounce(0, true, undefined)).toBe(false);
  });

  it('kill switch __RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__ restores the old stranding behavior', () => {
    window.__RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__ = true;
    expect(shouldHealStrandedDebounce(0, true, true)).toBe(false); // would-have-healed case now no-ops (the bug)
  });
});

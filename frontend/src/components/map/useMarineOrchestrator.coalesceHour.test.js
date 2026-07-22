/**
 * Layer-switch coalesce LIVE-HOUR resolution (2026-07-22, hunt defect 3.2). The coalesce body fires
 * SWITCH_FETCH_COALESCE_MS after the switch inside a frozen closure whose captured `timeOffsetHours`
 * is the switch-time hour; a scrub within that window moves the live hour. The model there already
 * resolves off the live ref, so the hour was the one stale input — the cache lookup/remap committed
 * the switch-time hour and overwrote the scrubbed display. resolveCoalesceHour picks the live ref
 * (authoritative) over the frozen prop, with a kill switch to restore the legacy behavior.
 */
import { resolveCoalesceHour } from './useMarineOrchestrator';

describe('resolveCoalesceHour (layer-switch coalesce live-hour resolution)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MARINE_COALESCE_LIVE_HOUR__; });

  it('prefers the LIVE ref hour over the frozen switch-time prop (the fix)', () => {
    // Switch happened at hour 0; user scrubbed to 48 within the coalesce window → ref is live.
    expect(resolveCoalesceHour(0, 48)).toBe(48);
  });

  it('returns the prop unchanged when the hour did not move (ref === prop)', () => {
    expect(resolveCoalesceHour(24, 24)).toBe(24);
  });

  it('kill switch __RAW_DISABLE_MARINE_COALESCE_LIVE_HOUR__ restores the frozen-prop behavior (the bug)', () => {
    window.__RAW_DISABLE_MARINE_COALESCE_LIVE_HOUR__ = true;
    expect(resolveCoalesceHour(0, 48)).toBe(0); // the stale switch-time hour — reproduces the defect
  });

  it('falls back to the prop when the ref is not a usable number (defensive)', () => {
    expect(resolveCoalesceHour(12, undefined)).toBe(12);
    expect(resolveCoalesceHour(12, null)).toBe(12);
    expect(resolveCoalesceHour(12, NaN)).toBe(12); // NaN is typeof 'number' but must not clobber a valid prop
  });
});

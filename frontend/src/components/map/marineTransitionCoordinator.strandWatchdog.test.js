// Unit tests for decideStrandAction — the pure decision behind the model/layer switch STRAND WATCHDOG
// (2026-07-22). Live-reproduced strand: a switch calls beginTransition (pending), the fetcher early-returns
// before dispatch (e.g. isScrubbing/isCommitting guard, isMoving+hasValidData, same-target-inflight,
// cooldown), and because the fetcher's finally ends the transition ONLY once requestId is bumped at
// dispatch, the transition stays PENDING forever with __MARINE_FETCH_PENDING__ null and the new model never
// commits. decideStrandAction picks: heal it (re-drive) ONLY on that exact "fp:null, pending, displayed!=
// target" signature, never pile onto a healthy in-flight fetch, and give up honestly after a bounded budget.

import { decideStrandAction } from './marineTransitionCoordinator';

const pending = (gen, model = 'GFS', layer = 'waves') => ({ gen, status: 'pending', model, layer });
const settled = (gen, model = 'GFS', layer = 'waves') => ({ gen, status: 'settled', model, layer });

describe('decideStrandAction — the five outcomes', () => {
  test("no target → 'superseded' (nothing to heal)", () => {
    expect(decideStrandAction({ target: null, armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 0 }))
      .toBe('superseded');
  });

  test("a newer switch bumped the generation → 'superseded'", () => {
    expect(decideStrandAction({ target: pending(7), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 0 }))
      .toBe('superseded');
  });

  test("transition already settled → 'healed'", () => {
    expect(decideStrandAction({ target: settled(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 0 }))
      .toBe('healed');
  });

  test("displayed frame already IS the target → 'healed' (even while status still pending pre-markDisplayed race)", () => {
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: true, fetchPendingModel: null, attempts: 0 }))
      .toBe('healed');
  });

  test("pending + displayed!=target + a fetch for THIS target is in flight → 'inflight_wait' (do not pile on)", () => {
    expect(decideStrandAction({ target: pending(5, 'EURO'), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: 'EURO', attempts: 0 }))
      .toBe('inflight_wait');
  });

  test("THE STRAND: pending + displayed!=target + fp null → 'redrive'", () => {
    expect(decideStrandAction({ target: pending(5, 'EURO'), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 0 }))
      .toBe('redrive');
  });

  test("a fetch for a DIFFERENT model in flight does NOT rescue this target → 'redrive'", () => {
    // e.g. a stale/other-model viewport refetch is pending; it will never settle THIS switch's target.
    expect(decideStrandAction({ target: pending(5, 'EURO'), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: 'GFS', attempts: 0 }))
      .toBe('redrive');
  });

  test("attempts exhausted → 'giveup'", () => {
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 4 }))
      .toBe('giveup');
  });
});

describe('decideStrandAction — precedence: superseded > healed > giveup > inflight_wait > redrive', () => {
  test("superseded beats everything (even attempts exhausted)", () => {
    expect(decideStrandAction({ target: pending(9), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: 'GFS', attempts: 99 }))
      .toBe('superseded');
  });

  test("healed beats giveup (a settled transition at max attempts is healed, not given up)", () => {
    expect(decideStrandAction({ target: settled(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 99 }))
      .toBe('healed');
  });

  test("giveup beats inflight_wait and redrive once the budget is spent", () => {
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: 'GFS', attempts: 4 }))
      .toBe('giveup');
  });
});

describe('decideStrandAction — attempt budget boundaries', () => {
  test("default maxAttempts is 4: attempts 0..3 → not giveup, attempts 4 → giveup", () => {
    for (let a = 0; a < 4; a++) {
      expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: a }))
        .toBe('redrive');
    }
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 4 }))
      .toBe('giveup');
  });

  test("custom maxAttempts is honored", () => {
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 1, maxAttempts: 2 }))
      .toBe('redrive');
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 2, maxAttempts: 2 }))
      .toBe('giveup');
  });

  test("non-numeric attempts never triggers giveup (falls through to the strand decision)", () => {
    expect(decideStrandAction({ target: pending(5), armedGen: 5, displayedMatchesTarget: false, fetchPendingModel: null, attempts: undefined }))
      .toBe('redrive');
  });
});

describe('decideStrandAction — defensive / empty args', () => {
  test("called with no args → 'superseded' (no target)", () => {
    expect(decideStrandAction()).toBe('superseded');
  });

  test("gen 0 armed against a gen-0 target is NOT auto-superseded (identity holds)", () => {
    // beginTransition starts at gen 1, but the pure fn must not special-case 0.
    expect(decideStrandAction({ target: pending(0), armedGen: 0, displayedMatchesTarget: false, fetchPendingModel: null, attempts: 0 }))
      .toBe('redrive');
  });
});

/**
 * Transition-hold for deactivation clears.
 *
 * 2026-07-06 ("models not switching fast"): a model/layer switch blinks the marine layer
 * inactive during the style transition; clearing resident GPU state on that blink forced a
 * full re-encode + two particle resets per switch. Deactivation HOLDS while a transition/
 * fetch is in flight (in-family branch).
 *
 * 2026-07-11 (audit #27 "marine clears when toggling to wind"): cross-family toggles set none
 * of the in-family flags, so both clear sites fired and the return leg paid a full re-encode +
 * mask rebuild + two particle resets while wind retained across the same gesture. Deactivation
 * now ALSO holds for a TTL with no flags set (cross-family branch); expiry past the TTL clears,
 * and reactivation (noteMarineActive) resets the clock. Blank-heatmap safety: the residency-
 * aware upload diff re-uploads whenever the engine is actually empty, so an expired-then-
 * cleared engine can never dup-skip into a blank.
 */
import {
  shouldHoldClearOnDeactivate,
  noteMarineActive,
  __resetForTests,
} from './marineTransitionCoordinator';

describe('shouldHoldClearOnDeactivate', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    delete window.__MARINE_TRANSITIONING__;
    delete window.__MARINE_FETCH_PENDING__;
    delete window.__MARINE_FETCH_DEBOUNCING__;
    delete window.__RAW_DISABLE_CLEAR_HOLD__;
    delete window.__RAW_MARINE_XFAM_HOLD_DISABLED__;
    delete window.__RAW_MARINE_XFAM_HOLD_TTL_MS__;
    delete window.__MARINE_CLEAR_HELD__;
    delete window.__MARINE_XFAM_HOLD_COUNT__;
    delete window.__MARINE_CHURN__;
    delete window.__MARINE_CHURN_RESET__;
  });

  describe('in-family transition hold (2026-07-06 contract)', () => {
    it('holds during a model/layer transition and counts the hold', () => {
      window.__MARINE_TRANSITIONING__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(true);
      expect(window.__MARINE_CLEAR_HELD__).toBe(1);
      // in-family holds do NOT tick the cross-family counter
      expect(window.__MARINE_XFAM_HOLD_COUNT__).toBeUndefined();
    });

    it('holds while a fetch is pending or debouncing', () => {
      window.__MARINE_FETCH_PENDING__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(true);
      delete window.__MARINE_FETCH_PENDING__;
      window.__MARINE_FETCH_DEBOUNCING__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(true);
    });

    it('global kill switch disables ALL holds', () => {
      window.__MARINE_TRANSITIONING__ = true;
      window.__RAW_DISABLE_CLEAR_HOLD__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(false);
    });
  });

  describe('cross-family toggle hold (audit #27 contract)', () => {
    it('holds a real toggle-off within the TTL and counts it', () => {
      // no in-family flags set — the pre-#27 behavior was an immediate clear
      expect(shouldHoldClearOnDeactivate()).toBe(true);
      expect(window.__MARINE_XFAM_HOLD_COUNT__).toBe(1);
      expect(shouldHoldClearOnDeactivate()).toBe(true);
      expect(window.__MARINE_XFAM_HOLD_COUNT__).toBe(2);
      // the in-family counter is untouched
      expect(window.__MARINE_CLEAR_HELD__).toBeUndefined();
    });

    it('clears once the TTL has lapsed, and logs the expiry churn event exactly once', () => {
      window.__RAW_MARINE_XFAM_HOLD_TTL_MS__ = 0; // immediate expiry
      expect(shouldHoldClearOnDeactivate()).toBe(false);
      expect(shouldHoldClearOnDeactivate()).toBe(false);
      expect(window.__MARINE_CHURN__.counts.xfam_hold_expired).toBe(1);
    });

    it('noteMarineActive resets the clock so the next deactivation holds again', () => {
      window.__RAW_MARINE_XFAM_HOLD_TTL_MS__ = 0;
      expect(shouldHoldClearOnDeactivate()).toBe(false); // expired
      noteMarineActive(); // marine reactivated
      window.__RAW_MARINE_XFAM_HOLD_TTL_MS__ = 60000;
      expect(shouldHoldClearOnDeactivate()).toBe(true); // fresh clock → holds
    });

    it('cross-family kill switch restores the pre-#27 immediate clear (in-family hold intact)', () => {
      window.__RAW_MARINE_XFAM_HOLD_DISABLED__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(false);
      window.__MARINE_TRANSITIONING__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(true);
    });

    it('deactivation outliving an in-family transition falls into the TTL hold, then clears', () => {
      window.__MARINE_TRANSITIONING__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(true); // flag hold
      window.__MARINE_TRANSITIONING__ = false;
      expect(shouldHoldClearOnDeactivate()).toBe(true); // TTL hold takes over
      window.__RAW_MARINE_XFAM_HOLD_TTL_MS__ = 0;
      // clock restarts relative to the first TTL call above, but TTL=0 always lapses
      expect(shouldHoldClearOnDeactivate()).toBe(false);
    });

    it('global kill switch also disables the cross-family hold', () => {
      window.__RAW_DISABLE_CLEAR_HOLD__ = true;
      expect(shouldHoldClearOnDeactivate()).toBe(false);
      expect(window.__MARINE_XFAM_HOLD_COUNT__).toBeUndefined();
    });
  });
});

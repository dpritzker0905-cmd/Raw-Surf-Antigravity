/**
 * Transition-hold for deactivation clears (2026-07-06, "models not switching fast"): a model/
 * layer switch blinks the marine layer inactive during the style transition; clearing resident
 * GPU state on that blink forced a full re-encode + two particle resets per switch. Deactivation
 * must HOLD while a transition/fetch is in flight and still clear on a real toggle-off.
 */
import { shouldHoldClearOnDeactivate } from './marineTransitionCoordinator';

describe('shouldHoldClearOnDeactivate', () => {
  afterEach(() => {
    delete window.__MARINE_TRANSITIONING__;
    delete window.__MARINE_FETCH_PENDING__;
    delete window.__MARINE_FETCH_DEBOUNCING__;
    delete window.__RAW_DISABLE_CLEAR_HOLD__;
    delete window.__MARINE_CLEAR_HELD__;
  });

  it('does NOT hold on a real toggle-off (no transition in flight)', () => {
    expect(shouldHoldClearOnDeactivate()).toBe(false);
    expect(window.__MARINE_CLEAR_HELD__).toBeUndefined();
  });

  it('holds during a model/layer transition and counts the hold', () => {
    window.__MARINE_TRANSITIONING__ = true;
    expect(shouldHoldClearOnDeactivate()).toBe(true);
    expect(window.__MARINE_CLEAR_HELD__).toBe(1);
  });

  it('holds while a fetch is pending or debouncing', () => {
    window.__MARINE_FETCH_PENDING__ = true;
    expect(shouldHoldClearOnDeactivate()).toBe(true);
    delete window.__MARINE_FETCH_PENDING__;
    window.__MARINE_FETCH_DEBOUNCING__ = true;
    expect(shouldHoldClearOnDeactivate()).toBe(true);
  });

  it('clears once the transition ends (deferred clear on outliving deactivation)', () => {
    window.__MARINE_TRANSITIONING__ = true;
    expect(shouldHoldClearOnDeactivate()).toBe(true);
    window.__MARINE_TRANSITIONING__ = false;
    expect(shouldHoldClearOnDeactivate()).toBe(false);
  });

  it('respects the kill switch', () => {
    window.__MARINE_TRANSITIONING__ = true;
    window.__RAW_DISABLE_CLEAR_HOLD__ = true;
    expect(shouldHoldClearOnDeactivate()).toBe(false);
  });
});

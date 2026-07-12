import {
  shouldUseClassicScrubber,
  clampWheelVelocity,
  wheelSettleTarget,
  wheelPitchPx,
  WHEEL_MAX_VEL_HPS,
} from './ForecastWheel';

// The Forecast Wheel's pure decision helpers (user-approved prototype d50c0923). The gesture/
// canvas surface is judged live; these pin the contracts the churn math and the kill switch
// depend on.

describe('ForecastWheel — pure helpers', () => {
  it('kill switch: __RAW_CLASSIC_SCRUBBER__ restores the classic slider', () => {
    expect(shouldUseClassicScrubber({})).toBe(false);
    expect(shouldUseClassicScrubber({ __RAW_CLASSIC_SCRUBBER__: true })).toBe(true);
    expect(shouldUseClassicScrubber({ __RAW_CLASSIC_SCRUBBER__: 'yes' })).toBe(false); // strict
  });

  it('velocity caps at ±6 hours/sec by default (a flick can never skip a day unseen)', () => {
    expect(clampWheelVelocity(40, {})).toBe(WHEEL_MAX_VEL_HPS);
    expect(clampWheelVelocity(-40, {})).toBe(-WHEEL_MAX_VEL_HPS);
    expect(clampWheelVelocity(3.2, {})).toBe(3.2);
  });

  it('velocity cap is a live lever (__RAW_WHEEL_MAX_HPS__)', () => {
    expect(clampWheelVelocity(40, { __RAW_WHEEL_MAX_HPS__: 12 })).toBe(12);
    expect(clampWheelVelocity(-40, { __RAW_WHEEL_MAX_HPS__: 12 })).toBe(-12);
    expect(clampWheelVelocity(40, { __RAW_WHEEL_MAX_HPS__: 0 })).toBe(WHEEL_MAX_VEL_HPS); // 0 = invalid, default
  });

  it('settle target snaps to the nearest detent INSIDE the track', () => {
    expect(wheelSettleTarget(3.4, 336)).toBe(3);
    expect(wheelSettleTarget(3.6, 336)).toBe(4);
    expect(wheelSettleTarget(-2.3, 336)).toBe(0);      // never before Now
    expect(wheelSettleTarget(999, 336)).toBe(336);     // never past the horizon
  });

  it('radar frames get a wider pitch than forecast hours (few frames stay readable)', () => {
    expect(wheelPitchPx(true, 12)).toBeGreaterThan(wheelPitchPx(false, 336));
  });
});

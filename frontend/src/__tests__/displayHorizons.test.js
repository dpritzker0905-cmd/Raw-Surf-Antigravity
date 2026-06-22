/**
 * F5 — single source of truth for display horizons. These frontend fallback constants are the
 * startup defaults before backend capabilities load; they MUST match the backend contract
 * (EURO marine max_forecast_hours = 336, ICON marine = 336). The backend pins the same values
 * in backend/tests/test_euro_marine_horizon_contract.py — change both together.
 *
 * forecastSamplers.js no longer redefines these locally (that duplication is what let EURO
 * drift to a stale 240h); it imports them from useMarineDataFetcherHelpers.
 */
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  EURO_NATIVE_HOURS,
} from '../components/map/useMarineDataFetcherHelpers';

describe('display horizon fallbacks — single source of truth (F5)', () => {
  it('match the backend capabilities contract (EURO/ICON marine max = 336h)', () => {
    expect(DISPLAY_EURO_WAVES_MAX_HOURS).toBe(336);
    expect(DISPLAY_EURO_COMPONENT_MAX_HOURS).toBe(336);
    expect(DISPLAY_ICON_MAX_HOURS).toBe(336);
  });

  it('keep the EURO native/estimate boundary distinct from the display max', () => {
    expect(EURO_NATIVE_HOURS).toBe(240);
    // 240 native + 96 estimated = 336 max
    expect(DISPLAY_EURO_WAVES_MAX_HOURS - EURO_NATIVE_HOURS).toBe(96);
  });
});

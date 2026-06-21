/**
 * forecastHorizonCap.test.js
 *
 * Far-hour fix (verified 2026-06-21): scrubbing ICON marine past its native 168h
 * horizon entered the "estimated extension" zone (max_forecast_hours=336) whose blend
 * needs GFS+EURO anchors loaded simultaneously. Mid-interaction those anchors are
 * absent, so the backend returns a conformed safe-zero grid and the exact-point fetch
 * times out -> infobox hangs on "Loading…" + blank heatmap at far hours. resolveForecastWindow
 * now caps the timeline to the NATIVE horizon (reliably-served hours) instead of the
 * optimistic estimated-extension max.
 */
import { resolveForecastWindow } from '../components/map/LayerAccessResolver';

const premium = { subscription_tier: 'premium' }; // 14-day tier ceiling

describe('resolveForecastWindow — native-horizon cap', () => {
  beforeEach(() => {
    if (typeof window === 'undefined') global.window = {};
    delete window.__FORCE_PREMIUM_TIER__;
  });
  afterEach(() => { window.__WEATHER_CAPABILITIES__ = undefined; });

  it('caps ICON marine to its native 168h (7d), not the 336h estimated-extension max', () => {
    window.__WEATHER_CAPABILITIES__ = [
      { model: 'ICON', domain: 'marine', layer: 'waves', supports_grid: true, supports_point: true,
        native_horizon_hours: 168, estimated_horizon_hours: 168, max_forecast_hours: 336 },
    ];
    expect(resolveForecastWindow(premium, 'ICON', 'waves')).toBe(7); // 168h, not 14 (336h)
  });

  it('leaves GFS marine at the tier ceiling (native 384h > 14d tier cap)', () => {
    window.__WEATHER_CAPABILITIES__ = [
      { model: 'GFS', domain: 'marine', layer: 'waves', supports_grid: true, supports_point: true,
        native_horizon_hours: 384, estimated_horizon_hours: 0, max_forecast_hours: 384 },
    ];
    expect(resolveForecastWindow(premium, 'GFS', 'waves')).toBe(14);
  });

  it('leaves EURO marine at its native 240h (10d)', () => {
    window.__WEATHER_CAPABILITIES__ = [
      { model: 'EURO', domain: 'marine', layer: 'waves', supports_grid: true, supports_point: true,
        native_horizon_hours: 240, estimated_horizon_hours: 0, max_forecast_hours: 240 },
    ];
    expect(resolveForecastWindow(premium, 'EURO', 'waves')).toBe(10);
  });

  it('falls back to max_forecast_hours when native_horizon_hours is absent (back-compat)', () => {
    window.__WEATHER_CAPABILITIES__ = [
      { model: 'ICON', domain: 'marine', layer: 'waves', supports_grid: true, supports_point: true,
        max_forecast_hours: 168 },
    ];
    expect(resolveForecastWindow(premium, 'ICON', 'waves')).toBe(7);
  });
});

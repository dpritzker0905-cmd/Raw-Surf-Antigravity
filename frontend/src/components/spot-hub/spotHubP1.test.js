/**
 * Spot-hub phase 1 (2026-11-03): the pure pieces, the infobox tide, and the explore card's window.
 *
 * ⛔ The tier windows here are asserted THROUGH the app's resolver (LayerAccessResolver), never as
 * literals copied from it: the point of phase 1 is that no hub surface owns a ladder.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { resolveForecastWindow } from '../map/LayerAccessResolver';
import {
  MISSING, displayDirection, displayPeriod, effectiveWindowHours, formatPointTide, forecastDayIndexForOffset, hubForecastWindow,
  sanitizePointTide, splitForecastWindow, spotHubP1Enabled, tideSourceLabel,
} from './spotHubP1';
import { mapPointRatingResponse } from '../map/pointRatingClient';
import { compileForecastCards } from '../map/forecastCardCompiler';
import ExploreSpotCard from '../ExploreSpotCard';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-03T04:55:00Z');
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse('2026-11-04T12:00:00Z') + i * 24 * H).toISOString().slice(0, 10),
  wave_height_max: 3 + i, wave_height_min: 2, label: 'Waist High', wave_period: 11,
}));

afterEach(() => {
  delete window.__RAW_DISABLE_SPOT_HUB_P1__;
  delete window.__WEATHER_CAPABILITIES__;
  localStorage.clear();
});

describe('one tier resolver', () => {
  test.each([['free', 'free'], [null, 'guest'], ['basic', 'basic'], ['tier_2', 'basic'], ['premium', 'premium']])(
    '%s takes the resolver\'s window for the wave layer', (tierIn, tierOut) => {
      const w = hubForecastWindow(tierIn, 'GFS');
      expect(w.tier).toBe(tierOut);
      expect(w.days).toBe(resolveForecastWindow(tierIn, 'GFS', 'waves'));
      expect(w.hours).toBe(w.days * 24);
    });

  test('the windows are the scrubber\'s: free 3 days, basic 7, premium 14', () => {
    expect(['free', 'basic', 'premium'].map((t) => hubForecastWindow(t).days)).toEqual([3, 7, 14]);
  });

  test('capabilities clamp the window, exactly as they clamp the scrubber', () => {
    window.__WEATHER_CAPABILITIES__ = [
      { model: 'ICON', domain: 'marine', layer: 'waves', max_forecast_hours: 168, supports_grid: true },
      { model: 'GFS', domain: 'marine', layer: 'waves', max_forecast_hours: 384, supports_grid: true },
    ];
    expect(hubForecastWindow('premium', 'ICON').days).toBe(7);
    expect(hubForecastWindow('premium', 'GFS').days).toBe(14);
  });

  test('a model the tier may not use falls back to an allowed one (getAllowedModels)', () => {
    const w = hubForecastWindow('free', 'EURO');
    expect(w.modelAllowed).toBe(false);
    expect(w.model).toBe('GFS');
    expect(hubForecastWindow('basic', 'EURO').model).toBe('EURO');
  });
});

describe('the window is rolling, as the scrubber\'s is', () => {
  test('free at 04:55Z opens the next two 12:00 UTC samples; the third is 79 h out', () => {
    const { open, locked } = splitForecastWindow(ROWS, 72, NOW);
    expect(open.map((r) => r.date)).toEqual(['2026-11-04', '2026-11-05']);
    expect(locked).toHaveLength(8);
    expect(locked[0]).toEqual({ date: '2026-11-06', locked: true });   // a date, never the data
  });

  test('a sample exactly at the horizon is open', () => {
    expect(splitForecastWindow(ROWS, 72, Date.parse('2026-11-03T12:00:00Z')).open).toHaveLength(3);
  });

  test("the server's applied horizon caps the resolver's, never raises it", () => {
    expect(effectiveWindowHours(336, 72)).toBe(72);
    expect(effectiveWindowHours(72, 336)).toBe(72);
    expect(effectiveWindowHours(72, undefined)).toBe(72);
    expect(effectiveWindowHours(72, 'x')).toBe(72);
  });

  test('server-withheld dates become locked previews, deduplicated and in order', () => {
    const { open, locked } = splitForecastWindow(ROWS.slice(0, 2), 72, NOW, ['2026-11-07', '2026-11-06', '2026-11-05', 'x']);
    expect(open).toHaveLength(2);
    expect(locked.map((r) => r.date)).toEqual(['2026-11-06', '2026-11-07']);
  });
});

describe('the day scroll places the map hour by its UTC date', () => {
  test.each([[0, -1], [19, -1], [20, 0], [24, 0], [44, 1], [48, 1], [500, 9]])('+%sh -> card %s', (offset, index) => {
    expect(forecastDayIndexForOffset(ROWS, offset, NOW)).toBe(index);
  });
  test('the old floor(offset / 24) was one card late', () => {
    expect(Math.floor(24 / 24)).toBe(1);
    expect(forecastDayIndexForOffset(ROWS, 24, NOW)).toBe(0);
  });
  test('no rows: no card', () => expect(forecastDayIndexForOffset([], 24, NOW)).toBe(-1));
});

describe('missing values render "—", never 0', () => {
  test.each([[null, MISSING], [undefined, MISSING], [0, MISSING], [-1, MISSING], ['x', MISSING], [11.23, '11.2s']])(
    'period %p -> %p', (p, out) => expect(displayPeriod(p)).toBe(out));
  test('direction: absent, NaN, and the backend\'s 0-with-no-period pair are missing', () => {
    expect(displayDirection(null, 10)).toBe(MISSING);
    expect(displayDirection('x', 10)).toBe(MISSING);
    expect(displayDirection(0, 0)).toBe(MISSING);
    expect(displayDirection(0, null)).toBe(MISSING);
  });
  test('direction: a real reading has degrees and a compass point, and 0 beside a period is north', () => {
    expect(displayDirection(65.61, 9)).toBe('66° ENE');
    expect(displayDirection(0, 12)).toBe('0° N');
  });
});

describe('tides', () => {
  test('the point tide keeps its sign and trend; absent is null, not 0', () => {
    expect(sanitizePointTide({ height_m: 0.4, norm: 0.7, trend: 'rising' })).toEqual({ heightM: 0.4, heightFt: 1.3, trend: 'Rising' });
    expect(formatPointTide(sanitizePointTide({ height_m: -0.3, trend: 'falling' }))).toBe('−1.0 ft, Falling');
    expect(formatPointTide(sanitizePointTide({ height_m: 0, trend: 'slack' }))).toBe('0.0 ft, Slack');
    expect(sanitizePointTide(null)).toBeNull();
    expect(sanitizePointTide({ height_m: null, trend: 'rising' })).toBeNull();
    expect(sanitizePointTide({ height_m: 'x' })).toBeNull();
  });

  test('the tide source line names the modelled sea level; NOAA only on the NOAA rollback', () => {
    expect(tideSourceLabel({ source: 'global' })).toMatch(/Open-Meteo modelled sea level, mean sea level/);
    expect(tideSourceLabel({ station_id: 'open-meteo:sea_level_height_msl' })).toMatch(/mean sea level/);
    expect(tideSourceLabel({ station_id: '8721604' })).toBe('Data from NOAA Tides & Currents');
  });

  const RESPONSE = { source: 'precomputed', rating: { score: 60, level: 'good', tide: { height_m: 0.4, norm: 0.7, trend: 'rising' } } };

  test('pointRatingClient passes rating.tide through; no tide, no key', () => {
    expect(mapPointRatingResponse(RESPONSE).tide).toEqual({ heightM: 0.4, heightFt: 1.3, trend: 'Rising' });
    expect('tide' in mapPointRatingResponse({ rating: { score: 60, level: 'good' } })).toBe(false);
  });

  const cards = (surfRating) => compileForecastCards({
    activeLayer: 'waves', activeModel: 'GFS', isLoading: false, isExactPointAuthority: true,
    exactPointStatus: 'exact_success', waveHeight: 1, wavePeriod: 12, waveDir: 270, degToCompass: () => 'W',
    heightUnit: 'ft', surfRating,
    useExactPoint: { wave_height: 1, wave_period: 12, wave_direction: 270, surf_height_m: 2, surf_regime: 'shoaling', surf_nearshore: true },
  });

  test('the infobox shows the tide with its honest label, right after the rating', () => {
    const list = cards(mapPointRatingResponse(RESPONSE));
    const i = list.findIndex((c) => c.label === 'Tide');
    expect(list[i - 1].label).toBe('Rating');
    expect(list[i]).toMatchObject({ value: '+1.3 ft, Rising', note: 'model estimate, mean sea level',
      ariaLabel: 'Tide (model estimate, mean sea level): +1.3 feet, Rising' });
  });

  test('no tide in the answer: no Tide row at all', () => {
    expect(cards({ score: 60, level: 'good' }).some((c) => c.label === 'Tide')).toBe(false);
  });

  test('kill switch: the Tide row is gone', () => {
    window.__RAW_DISABLE_SPOT_HUB_P1__ = true;
    expect(spotHubP1Enabled()).toBe(false);
    expect(cards(mapPointRatingResponse(RESPONSE)).some((c) => c.label === 'Tide')).toBe(false);
  });
});

describe('explore card takes the resolver window', () => {
  const spot = (extra) => ({ id: 's', name: 'Spot', region: 'R', latitude: 1, longitude: 1, current_conditions: null,
    forecast: ROWS, recent_reports: [], active_photographers: [], gallery: [], forecast_days_allowed: 10, ...extra });
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => { Date.now.mockRestore(); });

  test('free: the rolling-72 h rows, the rest locked behind a real upgrade button', () => {
    render(<ExploreSpotCard spot={spot()} userSubscriptionTier="free" />);
    expect(screen.getByText('2 Days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to unlock 8 more forecast days' })).toBeInTheDocument();
  });

  test('premium: every row that exists (10), no upsell', () => {
    render(<ExploreSpotCard spot={spot()} userSubscriptionTier="premium" />);
    expect(screen.getByText('10 Days')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to unlock/ })).toBeNull();
  });

  test('kill switch: the server\'s forecast_days_allowed again', () => {
    window.__RAW_DISABLE_SPOT_HUB_P1__ = true;
    render(<ExploreSpotCard spot={spot({ forecast_days_allowed: 3 })} userSubscriptionTier="free" />);
    expect(screen.getByText('3 Days')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade to unlock/ })).toBeNull();
  });
});

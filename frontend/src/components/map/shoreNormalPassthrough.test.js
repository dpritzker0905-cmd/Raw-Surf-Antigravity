/**
 * Regression pin (2026-07-26): `shore_normal_deg` must survive the point mappers.
 *
 * MapForecastOverlay.js feeds `useExactPoint?.shore_normal_deg` into computeSurfRating as
 * shoreNormalDeg. Every point mapper used to drop the field, so it was ALWAYS undefined and the
 * infobox rating was permanently geometry-blind:
 *   - offshoreness() -> null  => windQuality falls to the speed-only 5-rung ladder
 *   - swellExposure() -> 1.0  => the swell angle never penalises anything
 * The backend has always served it (schemas.py:184, point_resolution.py:128; verified live on
 * /api/weather/point: shore_normal_deg 247.93). Nothing asserted its absence, so it went unnoticed.
 */
import { selectExactPointHour } from './forecastSamplers';
import { computeSurfRating, windQuality, swellExposure } from './surfRating';

const T0 = '2026-07-26T17:00:00Z';

function cached(extra = {}) {
  return {
    hourly: {
      time: [T0],
      wave_height: [1.5],
      wave_period: [12],
      wind_speed_10m: [12],
      wind_direction_10m: [270],
    },
    source: 'exact_point_api',
    surf_height_m: 1.5,
    surf_regime: 'shoaling',
    shelf_depth_m: 60,
    ...extra,
  };
}

describe('shore_normal_deg passthrough', () => {
  test('selectExactPointHour carries shore_normal_deg from the backend response', () => {
    const out = selectExactPointHour(cached({ shore_normal_deg: 247.93 }), 0);
    expect(out.shore_normal_deg).toBeCloseTo(247.93, 2);
  });

  test('absent shore_normal_deg maps to null, never undefined', () => {
    const out = selectExactPointHour(cached(), 0);
    expect(out.shore_normal_deg).toBeNull();
  });

  test('the field materially changes the rating — proving the drop was not cosmetic', () => {
    // 1.5 m / 12 s, 23 kt wind FROM 90 deg at a shore facing 90 deg = dead ONSHORE,
    // with the swell arriving 45 deg off the shore normal.
    const args = [1.5, 12.0, 23 / 1.943844, 90.0];
    const withGeom = computeSurfRating(...args, 90.0, 135.0);
    const blind = computeSurfRating(...args, null, 135.0);
    expect(withGeom.score).not.toBeCloseTo(blind.score, 1);
    // geometry-aware must be HARSHER here: onshore wind + off-angle swell both penalise
    expect(withGeom.score).toBeLessThan(blind.score);
  });

  test('the two blinded channels are exactly the ones the drop disabled', () => {
    // wind: without a shore normal, direction is ignored entirely
    expect(windQuality(23 / 1.943844, 90.0, null)).toEqual(windQuality(23 / 1.943844, 270.0, null));
    expect(windQuality(23 / 1.943844, 90.0, 90.0)).not.toEqual(windQuality(23 / 1.943844, 270.0, 90.0));
    // exposure: without a shore normal it is pinned neutral
    expect(swellExposure(135.0, null)).toBe(1.0);
    expect(swellExposure(135.0, 90.0)).toBeLessThan(1.0);
  });
});

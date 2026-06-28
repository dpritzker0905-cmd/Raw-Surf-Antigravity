import {
  computeSurfRating, ratingScore, sizeScore, periodQuality, windQuality, offshoreness,
  swellExposure, scoreToLevel, RATING_LEVELS, RATING_LABEL, RATING_COLOR,
} from '../components/map/surfRating';

// Parity mirror of backend tests/test_surf_rating.py — keep the two in sync.
describe('surfRating (JS mirror of surf_rating.py)', () => {
  test('the 7 surf-quality levels', () => {
    expect(RATING_LEVELS).toEqual(['very_poor', 'poor', 'poor_fair', 'fair', 'fair_good', 'good', 'epic']);
  });

  test('swell exposure: head-on / grazing / blocked / unknown', () => {
    expect(swellExposure(270, 270)).toBe(1.0);          // head-on
    expect(Math.abs(swellExposure(180, 270) - 0.10)).toBeLessThan(0.02); // along-shore
    expect(swellExposure(90, 270)).toBeLessThanOrEqual(0.11);            // from behind -> floored
    expect(swellExposure(null, 270)).toBe(1.0);         // unknown -> neutral
    expect(swellExposure(220, null)).toBe(1.0);
  });

  test('swell angle gates the rating (head-on > grazing; unknown == prior)', () => {
    const headOn = computeSurfRating(1.5, 14, 3.0, 90, 270, 270).score;
    const grazing = computeSurfRating(1.5, 14, 3.0, 90, 270, 180).score;
    expect(headOn).toBeGreaterThan(grazing);
    expect(computeSurfRating(1.5, 14, 3.0, 90, 270).score).toBe(headOn); // unknown swell-from unchanged
  });

  test('flat is very_poor regardless of wind/period', () => {
    const { score, level } = computeSurfRating(0.1, 16, 1.0, 90, 270);
    expect(score).toBe(0);
    expect(level).toBe('very_poor');
  });

  test('big clean long-period offshore is epic', () => {
    // coast faces west (seaward 270); offshore wind blows from land (east) -> FROM ~90.
    const { score, level } = computeSurfRating(2.0, 15, 3.0, 90, 270);
    expect(score).toBeGreaterThanOrEqual(84);
    expect(level).toBe('epic');
  });

  test('strong onshore blows it out', () => {
    const { score, level } = computeSurfRating(1.5, 8, 18 / 1.943844, 270, 270);
    expect(score).toBeLessThan(28);
    expect(['very_poor', 'poor']).toContain(level);
  });

  test('offshoreness sign convention', () => {
    expect(offshoreness(270, 270)).toBeLessThan(-0.99);  // onshore (from sea)
    expect(offshoreness(90, 270)).toBeGreaterThan(0.99);  // offshore (from land)
    expect(Math.abs(offshoreness(0, 270))).toBeLessThan(0.01); // cross
    expect(offshoreness(null, 270)).toBeNull();
  });

  test('glassy is clean regardless of direction', () => {
    expect(windQuality(1.0)).toBe(1.0);
    expect(windQuality(1.0, 270, 270)).toBe(1.0);
  });

  test('offshore tolerates more speed than onshore', () => {
    const ms = 14 / 1.943844;
    expect(windQuality(ms, 90, 270)).toBeGreaterThan(windQuality(ms, 270, 270));
  });

  test('size gates then saturates (big not penalized)', () => {
    expect(sizeScore(0.1)).toBe(0);
    expect(sizeScore(1.5)).toBe(1);
    expect(sizeScore(5.0)).toBe(1);
  });

  test('period quality monotonic short->long', () => {
    expect(periodQuality(5)).toBe(0.4);
    expect(periodQuality(16)).toBe(1.0);
    expect(periodQuality(11)).toBeGreaterThan(periodQuality(8));
  });

  test('speed-only path when no shore-normal', () => {
    const light = ratingScore(1.5, 12, 4 / 1.943844);
    const strong = ratingScore(1.5, 12, 28 / 1.943844);
    expect(light).toBeGreaterThan(strong);
  });

  test('score_to_level buckets', () => {
    expect(scoreToLevel(0)).toBe('very_poor');
    expect(scoreToLevel(20)).toBe('poor');
    expect(scoreToLevel(35)).toBe('poor_fair');
    expect(scoreToLevel(50)).toBe('fair');
    expect(scoreToLevel(64)).toBe('fair_good');
    expect(scoreToLevel(78)).toBe('good');
    expect(scoreToLevel(95)).toBe('epic');
    expect(scoreToLevel(null)).toBe('unknown');
  });

  test('missing surf height -> unknown; labels+colors cover every level', () => {
    expect(computeSurfRating(null, 12, 5).level).toBe('unknown');
    [...RATING_LEVELS, 'unknown'].forEach((lvl) => {
      expect(RATING_LABEL[lvl]).toBeTruthy();
      expect(RATING_COLOR[lvl]).toMatch(/^#/);
    });
  });
});

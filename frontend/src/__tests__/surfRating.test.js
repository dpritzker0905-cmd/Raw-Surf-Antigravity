import {
  computeSurfRating, ratingScore, sizeScore, periodQuality, windQuality, offshoreness,
  swellExposure, scoreToLevel, RATING_LEVELS, RATING_LABEL, RATING_COLOR,
  parseBestTide, tideFit, breakerTypeQuality,
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

  test('size reference: null is backward-compatible; local ref is relative to spot', () => {
    // No reference (and explicit 1.2 m default) reproduce the legacy global curve exactly.
    [0.05, 0.2, 0.3, 0.6, 0.9, 1.2, 1.5, 5.0].forEach((h) => {
      const legacy = h <= 0.2 ? 0.0 : (h >= 1.2 ? 1.0 : (h - 0.2) / 1.0);
      expect(sizeScore(h)).toBeCloseTo(legacy, 6);
      expect(sizeScore(h, 1.2)).toBeCloseTo(legacy, 6);
    });
    // Local calibration: 2 ft is fully working at a small-wave spot, small at a big-wave spot.
    expect(sizeScore(0.6, 0.6)).toBe(1.0);
    expect(sizeScore(0.6, 2.5)).toBeLessThan(0.25);
    expect(sizeScore(0.15, 0.6)).toBe(0.0);        // absolute unrideable floor still applies
    expect(sizeScore(3.0, 0.6)).toBe(1.0);         // bigger than local ref still saturates
    // THE Florida case: local ref lifts a clean small-wave day above the global-default score.
    const args = [0.8, 11.0, 2.0, 90.0, 270.0, 90.0];
    const globalScore = computeSurfRating(...args).score;
    const flScore = computeSurfRating(...args, null, null, null, 0.7).score;  // tide/bestTide/xi null, ref 0.7
    expect(flScore).toBeGreaterThan(globalScore);
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

  test('parseBestTide bands (mirror of py)', () => {
    expect(parseBestTide('Low')).toEqual([0.0, 0.35]);
    expect(parseBestTide('Mid')).toEqual([0.33, 0.67]);
    expect(parseBestTide('High')).toEqual([0.65, 1.0]);
    expect(parseBestTide('Low to mid')).toEqual([0.0, 0.60]); // compound beats 'low'
    expect(parseBestTide('Mid to high')).toEqual([0.40, 1.0]);
    expect(parseBestTide('All tides')).toBeNull();
    expect(parseBestTide('')).toBeNull();
    expect(parseBestTide(null)).toBeNull();
    expect(parseBestTide('incoming')).toBeNull();
  });

  test('tideFit band + taper + neutral (mirror of py)', () => {
    const band = [0.65, 1.0];
    expect(tideFit(0.8, band)).toBe(1.0);
    expect(tideFit(0.65, band)).toBe(1.0);
    expect(tideFit(0.0, band)).toBeCloseTo(Math.max(0.5, 1.0 - 1.3 * 0.65), 5);
    expect(tideFit(0.5, band)).toBeCloseTo(1.0 - 1.3 * 0.15, 5);
    expect(tideFit(null, band)).toBe(1.0);
    expect(tideFit(0.5, null)).toBe(1.0);
    expect(tideFit(0.0, band)).toBeGreaterThanOrEqual(0.5);
  });

  test('wrong tide lowers the score but never zeroes it (parity)', () => {
    const base = computeSurfRating(1.5, 14, 1.0, 200, 270, 270).score;          // no tide -> neutral
    const wrong = computeSurfRating(1.5, 14, 1.0, 200, 270, 270, 0.0, 'High').score;
    const right = computeSurfRating(1.5, 14, 1.0, 200, 270, 270, 0.9, 'High').score;
    expect(wrong).toBeLessThan(base);
    expect(right).toBeCloseTo(base, 5);
    expect(wrong).toBeGreaterThan(0);
  });

  test('breakerTypeQuality + factor (mirror of py)', () => {
    expect(breakerTypeQuality(null)).toBe(1.0);
    expect(breakerTypeQuality(1.5)).toBe(1.0);   // plunging ideal
    expect(breakerTypeQuality(0.1)).toBeLessThan(1.0);  // spilling
    expect(breakerTypeQuality(8.0)).toBeLessThan(1.0);  // surging
    expect(breakerTypeQuality(0.0)).toBeGreaterThanOrEqual(0.82);
    const base = computeSurfRating(1.5, 14, 1.0, 200, 270, 270).score;
    const plunging = computeSurfRating(1.5, 14, 1.0, 200, 270, 270, null, null, 1.5).score;
    const spilling = computeSurfRating(1.5, 14, 1.0, 200, 270, 270, null, null, 0.1).score;
    expect(plunging).toBeCloseTo(base, 5);
    expect(spilling).toBeLessThan(base);
    expect(spilling).toBeGreaterThan(0);
  });
});

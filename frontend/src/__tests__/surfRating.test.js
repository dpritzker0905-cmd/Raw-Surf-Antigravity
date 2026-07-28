import {
  computeSurfRating, ratingScore, sizeScore, periodQuality, windQuality, offshoreness,
  swellExposure, scoreToLevel, RATING_LEVELS, RATING_LABEL, RATING_COLOR,
  parseBestTide, tideFit, breakerTypeQuality,
  dominantSwellPeriod, effectiveSwellExposure, seaCleanliness,
  observationGate, OBS_CAP_UNCONFIRMED, OBS_CAP_GOOD,
  windGate, WIND_GATE_START_KT, WIND_GATE_ZERO_KT,
  periodGate, PERIOD_GATE_FULL_S, PERIOD_GATE_FLOOR_S, PERIOD_GATE_FLOOR,
  oversizeGate, oversizeThresholds, OVERSIZE_FLOOR, OVERSIZE_ABS_START_M, OVERSIZE_ABS_FLOOR_M,
  OVERSIZE_GAMMA, OVERSIZE_MAX_BREAK_DEPTH_M, OVERSIZE_MIN_START_M,
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

  test('size reference: null is backward-compatible; local ref ANCHORS (not saturates) the curve', () => {
    // No reference reproduces the legacy global curve exactly (the LIVE default path). NOTE: an
    // EXPLICIT reference now selects the local-relative curve — only null is legacy (user anchors 07-12).
    [0.05, 0.2, 0.3, 0.6, 0.9, 1.2, 1.5, 5.0].forEach((h) => {
      const legacy = h <= 0.2 ? 0.0 : (h >= 1.2 ? 1.0 : (h - 0.2) / 1.0);
      expect(sizeScore(h)).toBeCloseTo(legacy, 6);
      expect(sizeScore(h, null)).toBeCloseTo(legacy, 6);
    });
    // Local calibration: the reference is the spot's ORDINARY good day -> anchor 0.6, saturate 2.5x.
    expect(sizeScore(0.6, 0.6)).toBeCloseTo(0.6, 9);
    expect(sizeScore(0.6, 2.5)).toBeLessThan(0.25);
    expect(sizeScore(0.15, 0.6)).toBe(0.0);        // absolute unrideable floor still applies
    expect(sizeScore(1.5, 0.6)).toBe(1.0);         // 2.5x ref saturates
    expect(sizeScore(3.0, 0.6)).toBe(1.0);         // beyond never penalized here
    // Locally-working still edges above globally-mediocre (0.638 vs 0.6 size factor).
    const args = [0.8, 11.0, 2.0, 90.0, 270.0, 90.0];
    const globalScore = computeSurfRating(...args).score;
    const flScore = computeSurfRating(...args, null, null, null, 0.7).score;  // tide/bestTide/xi null, ref 0.7
    expect(flScore).toBeGreaterThan(globalScore);
  });

  test('USER calibration anchors: FL fair at 2-3ft, fair-good at 3-4ft, Indo poor (parity with py)', () => {
    // SAME golden values as test_surf_rating.py::test_user_calibration_anchors_florida_and_indo.
    const clean = [11.0, 2.0, 90.0, 270.0, 270.0];             // tp, light dead-offshore, head-on swell
    const at25 = computeSurfRating(0.75, ...clean, null, null, null, 0.7);   // ~2.5 ft, FL ref 0.7
    expect(at25.score).toBeCloseTo(55.3, 1);
    expect(at25.level).toBe('fair');
    const at35 = computeSurfRating(1.05, ...clean, null, null, null, 0.7);   // ~3.5 ft
    expect(at35.score).toBeCloseTo(65.5, 1);
    expect(at35.level).toBe('fair_good');
    const typ = computeSurfRating(0.75, 9.0, 4.0, 90.0, 270.0, 270.0, null, null, null, 0.7);
    expect(typ.level).toBe('fair');                            // typical-clean 2-3 ft stays FAIR
    const indo = computeSurfRating(0.75, ...clean, null, null, null, 2.5);
    expect(indo.score).toBeLessThan(20.0);
    expect(['very_poor', 'poor']).toContain(indo.level);
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

  test('observationGate parity with rating_confirmation.py (Surfline hybrid)', () => {
    expect(observationGate(95.0)).toBe(OBS_CAP_UNCONFIRMED);   // model alone tops out at fair_good
    expect(observationGate(95.0, 'good')).toBe(OBS_CAP_GOOD);
    expect(observationGate(95.0, 'epic')).toBe(95.0);
    expect(observationGate(50.0)).toBe(50.0);                  // below the cap untouched
    expect(observationGate(null)).toBeNull();
    expect(scoreToLevel(OBS_CAP_UNCONFIRMED)).toBe('fair_good');
    expect(scoreToLevel(OBS_CAP_GOOD)).toBe('good');
  });

  test('wind direction penalty ramps with speed (parity with py forensic fix)', () => {
    const KT = 1.943844;
    const on6 = windQuality(6.0 / KT, 270.0, 270.0);          // 6 kt dead-onshore
    expect(on6).toBeCloseTo(0.6417, 3);                       // was 0.175 (blown-out class)
    expect(on6).toBeGreaterThan(0.5);
    expect(windQuality(12.0 / KT, 270.0, 270.0)).toBeCloseTo(0.10, 3);  // full penalty at 12 kt
    expect(windQuality(6.0 / KT, 90.0, 270.0)).toBeCloseTo(1.0 - 2.0 / 44.0, 9); // offshore unchanged
    const speeds = [4.0, 6.0, 8.0, 10.0, 12.0, 16.0].map((k) => windQuality(k / KT, 270.0, 270.0));
    speeds.slice(1).forEach((v, i) => expect(speeds[i]).toBeGreaterThanOrEqual(v));
  });

  // ── partition-aware factors (rating plan Step 3 seam; mirror of py tests) ──
  test('dominantSwellPeriod recovers groundswell under windsea', () => {
    const parts = [{ h: 1.2, tp: 16.0, dir: 270.0, kind: 'swell' },
                   { h: 0.8, tp: 8.0, dir: 250.0, kind: 'windsea' }];
    expect(dominantSwellPeriod(parts)).toBe(16.0);
    expect(dominantSwellPeriod([])).toBeNull();
    expect(dominantSwellPeriod(null)).toBeNull();
    expect(dominantSwellPeriod([{ h: null, tp: 12.0, kind: 'swell' }])).toBeNull();
  });

  test('effectiveSwellExposure is energy-weighted over swell trains only', () => {
    const parts = [{ h: 2.0, tp: 14.0, dir: 90.0, kind: 'swell' },
                   { h: 1.0, tp: 10.0, dir: 270.0, kind: 'swell' },
                   { h: 3.0, tp: 5.0, dir: 200.0, kind: 'windsea' }];
    expect(effectiveSwellExposure(parts, 270.0)).toBeCloseTo((4 * 0.1 + 1 * 1.0) / 5.0, 9); // 0.28
    expect(effectiveSwellExposure(parts, null)).toBeNull();
    expect(effectiveSwellExposure([{ h: 1.0, tp: 9.0, kind: 'swell' }], 270.0)).toBeNull(); // no dir
  });

  test('seaCleanliness fraction + floor', () => {
    expect(seaCleanliness(null)).toBe(1.0);
    expect(seaCleanliness([{ h: 1.0, kind: 'swell' }])).toBe(1.0);
    expect(seaCleanliness([{ h: 1.0, kind: 'swell' }, { h: 1.0, kind: 'windsea' }])).toBeCloseTo(0.75, 9);
    expect(seaCleanliness([{ h: 1.0, kind: 'windsea' }])).toBe(0.6);       // floored, never zeroes
  });

  test('partitions null/empty/degenerate are byte-identical to total-field', () => {
    const args = [1.5, 11.0, 2.0, 90.0, 270.0, 270.0];
    const base = ratingScore(...args);
    expect(ratingScore(...args, null, null, null, null, null)).toBe(base);
    expect(ratingScore(...args, null, null, null, null, [])).toBe(base);
    expect(ratingScore(...args, null, null, null, null,
      [{ h: null, tp: null, dir: null, kind: 'swell' }])).toBe(base);
  });

  test('partition-aware composite golden parity with backend', () => {
    // SAME golden values as tests/test_surf_rating.py::test_partition_aware_composite_parity_values.
    const args = [1.5, 11.0, 2.0, 90.0, 270.0, 270.0];
    const base = ratingScore(...args);
    expect(base).toBeCloseTo(89.3, 5);
    const clean = ratingScore(...args, null, null, null, null,
      [{ h: 1.2, tp: 16.0, dir: 270.0, kind: 'swell' }]);
    expect(clean).toBeCloseTo(100.0, 5);                     // 16 s groundswell recovered
    const messy = ratingScore(...args, null, null, null, null, [
      { h: 0.4, tp: 14.0, dir: 270.0, kind: 'swell' },
      { h: 1.2, tp: 5.0, dir: 250.0, kind: 'windsea' }]);
    expect(messy).toBeCloseTo(58.4, 5);                      // windsea-dominated: floor 0.6
    expect(messy).toBeLessThan(base);
    expect(clean).toBeGreaterThan(base);
  });

  test('secondary swell recovered when the dominant train is shadowed', () => {
    const args = [1.5, 11.0, 2.0, 90.0, 270.0, 90.0];        // total dir = the blocked train
    const parts = [{ h: 2.0, tp: 14.0, dir: 90.0, kind: 'swell' },
                   { h: 1.0, tp: 10.0, dir: 270.0, kind: 'swell' }];
    expect(ratingScore(...args, null, null, null, null, parts)).toBeGreaterThan(ratingScore(...args));
  });
});

// ── BLOWN-OUT VETO parity with surf_rating.wind_gate (2026-07-26) ─────────────────────────────────
// Backend goldens computed from the real engine; these MUST match or the glyph and the infobox drift.
describe('windGate (JS mirror of surf_rating.wind_gate)', () => {
  const KT = 1.943844;

  test('inert wherever it must be — it may only remove score from strong ONSHORE wind', () => {
    expect(windGate(40 / KT, 90.0, 270.0)).toBe(1.0);   // dead offshore, gale
    expect(windGate(40 / KT, 180.0, 270.0)).toBe(1.0);  // exactly cross-shore
    expect(windGate(40 / KT, null, null)).toBe(1.0);    // unknown geometry
    expect(windGate(10 / KT, 270.0, 270.0)).toBe(1.0);  // onshore but light
    expect(windGate(2.0, 90.0, 270.0)).toBe(1.0);       // the pinned calibration anchor's wind
    expect(windGate(null, 270.0, 270.0)).toBe(1.0);
  });

  test('a 100 kt dead-onshore gale is vetoed at every period', () => {
    for (const tp of [6, 9, 12, 16, 20]) {
      expect(ratingScore(2.0, tp, 100 / KT, 270.0, 270.0, 270.0)).toBe(0.0);
    }
  });

  test('score never rises as onshore wind grows (the period inversion is gone)', () => {
    for (const tp of [6, 12, 16, 20]) {
      let prev = Infinity;
      for (const kt of [12, 16, 25, 40, 100]) {
        const s = ratingScore(2.0, tp, kt / KT, 270.0, 270.0, 270.0);
        expect(s).toBeLessThanOrEqual(prev);
        prev = s;
      }
    }
  });

  test('PARITY: exact backend goldens at 2.0 m head-on, dead onshore', () => {
    // from services/weather_pipeline/surf_rating.py, re-derived 2026-07-29.
    // ⚠️ The tp=6 rows MOVED (17.5 -> 14.3, 11.0 -> 8.9) when the non-surfable-period veto shipped:
    // period_gate is inert at/above 7 s, so 6 s now carries a 0.8125 factor. tp=12 and tp=16 are
    // untouched, which is the check that the veto stayed in its lane.
    const golden = [
      [6, 16, 14.3], [6, 25, 8.9], [6, 40, 0.0],
      [12, 16, 32.3], [12, 25, 20.2], [12, 40, 0.0],
      [16, 16, 39.7], [16, 25, 24.8], [16, 40, 0.0],
    ];
    for (const [tp, kt, want] of golden) {
      expect(ratingScore(2.0, tp, kt / KT, 270.0, 270.0, 270.0)).toBeCloseTo(want, 1);
    }
  });

  test('kill switch restores the prior behaviour', () => {
    window.__RAW_DISABLE_WIND_GATE__ = true;
    expect(ratingScore(2.0, 16.0, 100 / KT, 270.0, 270.0, 270.0)).toBeCloseTo(43.0, 1);
    delete window.__RAW_DISABLE_WIND_GATE__;
    expect(ratingScore(2.0, 16.0, 100 / KT, 270.0, 270.0, 270.0)).toBe(0.0);
  });

  test('thresholds are the documented ones', () => {
    expect(WIND_GATE_START_KT).toBe(14.0);
    expect(WIND_GATE_ZERO_KT).toBe(40.0);
  });
});

// ── OVERSIZE VETO (parity mirror of backend test_surf_rating.py, 2026-07-29) ──────────────────────
// The defect: sizeScore is monotonic and clamps at 1.0, so 4 / 6 / 12 / 25 / 35 / 100 ft ALL scored
// 97.3 "epic" — a closeout rated identically to a groomed head-high day, at every spot.
describe('oversizeGate (JS mirror of surf_rating.oversize_gate)', () => {
  const CLEAN = [14.0, 2.0, 90.0, 270.0, 270.0];   // tp, wind m/s FROM land, head-on swell

  test('inert where it must be', () => {
    expect(oversizeGate(null)).toBe(1.0);
    expect(oversizeGate(0)).toBe(1.0);
    expect(oversizeGate(-1)).toBe(1.0);
    expect(oversizeGate(2.0)).toBe(1.0);                       // 6.6 ft: an ordinary good day
    expect(oversizeGate(7.9)).toBe(1.0);                       // just under the absolute taper
    expect(oversizeGate(OVERSIZE_ABS_START_M)).toBe(1.0);      // the taper starts here, does not bite
    expect(oversizeGate(8.0, 4.0)).toBe(1.0);                  // 26 ft at Mavericks: still Mavericks
  });

  test('tapers monotonically and NEVER zeroes (a 0 un-renders the map band)', () => {
    let prev = 1.0;
    for (const h of [8.0, 8.5, 9.0, 10.0, 12.0, 14.0, 20.0, 40.0]) {
      const g = oversizeGate(h);
      expect(g).toBeGreaterThan(0.0);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
    expect(oversizeGate(OVERSIZE_ABS_FLOOR_M)).toBeCloseTo(OVERSIZE_FLOOR, 6);
    expect(oversizeGate(1000.0)).toBeCloseTo(OVERSIZE_FLOOR, 6);
    expect(OVERSIZE_FLOOR).toBeGreaterThan(0.0);
  });

  test('spot-relative: the same height is a closeout at a beach break, a good day at Mavericks', () => {
    expect(oversizeGate(6.0, 0.7)).toBeCloseTo(OVERSIZE_FLOOR, 6);   // Cocoa Beach: closed out
    expect(oversizeGate(6.0, 2.5)).toBe(1.0);                        // Pipeline: fine
    expect(oversizeGate(6.0, 4.0)).toBe(1.0);                        // Mavericks: fine
  });

  test('a closeout no longer rates like a groomed head-high day', () => {
    const good = computeSurfRating(1.22, ...CLEAN);   // 4 ft
    const huge = computeSurfRating(10.8, ...CLEAN);   // 35.5 ft
    expect(good.level).toBe('epic');
    expect(huge.score).toBeGreaterThan(0.0);          // still rendered
    // Knowing nothing about the spot: only that it is no longer epic (the absolute pair is
    // deliberately late so unknown big-wave spots are not crushed).
    expect(['good', 'epic']).not.toContain(huge.level);
    expect(huge.score).toBeLessThan(good.score - 25.0);
  });

  // ⚠️⚠️ "Big wave surf spots are for big wave surfers" (owner, 2026-07-29). Real measured ETOPO
  // break depths — the same fixtures the backend test uses.
  test('bathymetric capacity gives a big-wave spot its own ceiling', () => {
    const h = 7.5;                                     // ~24.6 ft of breaking surf
    expect(oversizeGate(h, null, 22.1)).toBe(1.0);     // Mavericks: untouched
    expect(oversizeGate(h, null, 5.9)).toBeCloseTo(OVERSIZE_FLOOR, 6);  // Cocoa Beach: closed out
    const depths = [5.9, 9.0, 9.5, 11.1, 11.9, 21.0, 22.1, 24.5];
    const starts = depths.map((d) => oversizeThresholds(null, d)[0]);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  test('an absurd break depth fails OPEN instead of inventing capacity', () => {
    // Teahupo'o samples the deep water outside an unresolved reef pass: 273 m => 699 ft unbounded.
    const [teahupoo] = oversizeThresholds(null, 273.0);
    const [clamped] = oversizeThresholds(null, OVERSIZE_MAX_BREAK_DEPTH_M);
    expect(teahupoo).toBe(clamped);
    expect(teahupoo).toBeLessThan(20.0);
    expect(oversizeThresholds(null, Infinity)[0]).toBe(clamped);
  });

  test('a shallow or wrong depth cannot crush an ordinary day', () => {
    for (const shallow of [0.3, 1.0, 2.0, 4.0]) {
      expect(oversizeThresholds(null, shallow)[0]).toBeGreaterThanOrEqual(OVERSIZE_MIN_START_M);
    }
    expect(oversizeGate(1.5, null, 0.5)).toBe(1.0);
  });

  test('tier precedence: climatology beats bathymetry beats absolute', () => {
    expect(oversizeThresholds(0.7, 22.1)).toEqual([0.7 * 3.5, 0.7 * 6.0]);
    expect(oversizeThresholds(null, 22.1)[0]).toBeGreaterThan(OVERSIZE_ABS_START_M);
    expect(oversizeThresholds(null, null)).toEqual([OVERSIZE_ABS_START_M, OVERSIZE_ABS_FLOOR_M]);
    expect(OVERSIZE_GAMMA).toBe(0.78);
  });

  test('the pinned user calibration anchors are provably untouched', () => {
    for (const [h, ref] of [[0.75, 0.7], [1.05, 0.7], [0.75, 2.5], [0.75, null], [1.05, null]]) {
      expect(oversizeGate(h, ref)).toBe(1.0);
    }
  });

  test('kill switch restores the prior behaviour', () => {
    window.__RAW_DISABLE_OVERSIZE__ = true;
    expect(computeSurfRating(1.22, ...CLEAN).score).toBe(computeSurfRating(10.8, ...CLEAN).score);
    delete window.__RAW_DISABLE_OVERSIZE__;
    expect(computeSurfRating(1.22, ...CLEAN).score).toBeGreaterThan(computeSurfRating(10.8, ...CLEAN).score);
  });

  test('thresholds are the documented ones and match the backend', () => {
    expect(oversizeThresholds(null)).toEqual([8.0, 14.0]);
    expect(oversizeThresholds(0.7)).toEqual([0.7 * 3.5, 0.7 * 6.0]);
    expect(OVERSIZE_FLOOR).toBe(0.30);
  });
});

// ── NON-SURFABLE PERIOD VETO (parity mirror of backend test_surf_rating.py, 2026-07-29) ──────────
describe('periodGate (JS mirror of surf_rating.period_gate)', () => {
  const CLEAN = [2.0, 90.0, 270.0, 270.0];   // wind m/s FROM land, head-on swell

  test('inert where it must be, including unknown period', () => {
    expect(periodGate(null)).toBe(1.0);
    expect(periodGate(0)).toBe(1.0);
    expect(periodGate(-3)).toBe(1.0);
    for (const tp of [PERIOD_GATE_FULL_S, 8, 9, 11, 14, 20, 30]) expect(periodGate(tp)).toBe(1.0);
  });

  test('does not punish short-windswell coasts (Gulf / Med / Baltic / Great Lakes surf 5-8 s)', () => {
    expect(periodGate(8.0)).toBe(1.0);
    expect(periodGate(7.0)).toBe(1.0);
    expect(periodGate(6.0)).toBeGreaterThan(0.75);
    expect(periodGate(5.0)).toBeGreaterThan(0.55);
  });

  test('tapers monotonically and never zeroes', () => {
    let prev = 1.0;
    for (const tp of [7, 6, 5, 4, 3, 2, 0.5]) {
      const g = periodGate(tp);
      expect(g).toBeGreaterThan(0.0);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
    expect(periodGate(PERIOD_GATE_FLOOR_S)).toBeCloseTo(PERIOD_GATE_FLOOR, 9);
    expect(PERIOD_GATE_FLOOR).toBeGreaterThan(0.0);
  });

  test('ripples no longer rate good, and real windswell is untouched', () => {
    const at = (tp) => computeSurfRating(1.22, tp, ...CLEAN);
    expect(['very_poor', 'poor']).toContain(at(2.0).level);
    expect(['good', 'epic']).not.toContain(at(4.0).level);
    expect(at(8.0).level).toBe('good');
    expect(at(14.0).level).toBe('epic');
    const vals = [2, 3, 4, 6, 8, 14].map((tp) => at(tp).score);
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(60.0);
  });

  test('PARITY: backend goldens at 4 ft clean light offshore', () => {
    // ⚠️ tp=4 lands on EXACTLY 33.25, where the two languages disagree by 0.1: Python's round()
    // is banker's rounding (-> 33.2) and JS Math.round is half-up (-> 33.3). That divergence is
    // PRE-EXISTING in the shared `round(x*10)/10` convention, not introduced here; a 0.1 shift
    // cannot change the reported level except exactly on a 14-point bucket edge. Tolerance 0.15
    // documents it instead of hiding it.
    const at = (tp) => computeSurfRating(1.22, tp, ...CLEAN).score;
    expect(at(2.0)).toBeCloseTo(19.0, 1);
    expect(Math.abs(at(4.0) - 33.2)).toBeLessThanOrEqual(0.15);
    expect(at(6.0)).toBeCloseTo(61.8, 1);
    expect(at(8.0)).toBeCloseTo(81.3, 1);
    expect(scoreToLevel(at(4.0))).toBe('poor_fair');   // the LEVEL is identical either way
  });

  test('kill switch restores the prior behaviour', () => {
    window.__RAW_DISABLE_PERIOD_GATE__ = true;
    expect(computeSurfRating(1.22, 2.0, ...CLEAN).score)
      .toBe(computeSurfRating(1.22, 6.0, ...CLEAN).score);
    delete window.__RAW_DISABLE_PERIOD_GATE__;
    expect(computeSurfRating(1.22, 2.0, ...CLEAN).score)
      .toBeLessThan(computeSurfRating(1.22, 6.0, ...CLEAN).score);
  });

  test('the pinned user calibration anchors are provably untouched', () => {
    expect(periodGate(9.0)).toBe(1.0);
    expect(periodGate(11.0)).toBe(1.0);
  });
});

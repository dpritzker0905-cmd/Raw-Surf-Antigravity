/**
 * CROSS-LANGUAGE PARITY GATE (2026-07-26).
 *
 * `surfRating.js` is a hand-maintained mirror of `backend/services/weather_pipeline/surf_rating.py`.
 * The map glyph / spot list are scored by the BACKEND; the infobox is scored by this JS. When the two
 * drift, one spot shows two different ratings on one screen — which is exactly what happened when the
 * point mappers dropped `shore_normal_deg` (fixed in 12b0e1ec) and would have happened again when the
 * blown-out wind veto landed backend-only (shipped in both, 817379da).
 *
 * Structural review cannot catch numeric drift, so this asserts against 4320 goldens generated from
 * the real Python engine across height x period x wind speed x wind direction x swell direction x
 * {with, without} shore-normal.
 *
 * REGENERATE after any intentional change to either engine — ONE command:
 *
 *   python backend/scripts/gen_rating_parity_goldens.py
 *
 * (That script replaced a procedure that used to say "see the generator in the 2026-07-26 audit
 * notes". A regeneration step that lives in a chat log is not a step: when the period veto shipped
 * 2026-07-29 the goldens went stale and the grid had to be reverse-engineered from the JSON.)
 */
import { ratingScore, scoreToLevel } from '../components/map/surfRating';
import goldens from './__parity_goldens.json';

// KNOWN, MEASURED, BOUNDED ARTEFACT — not drift.
// Python's round() is banker's rounding (ties-to-even); JS Math.round is half-away-from-zero. Across
// these 4320 goldens that makes 55 scores (1.27%) differ by EXACTLY one rounding unit, 0.1, and the
// displayed LEVEL never differs (measured: levelDiffs = 0). Bit-matching CPython's float rounding in
// JS is fragile and would risk worse bugs than it fixes, so the contract is: levels must match
// EXACTLY, scores within one rounding unit. A failure here means real logic drift, not rounding.
const ROUNDING_UNIT = 0.1;

describe('JS/Python rating parity', () => {
  test('levels match exactly and scores stay within one rounding unit across 4320 goldens', () => {
    const levelDrift = [];
    const scoreDrift = [];
    for (const g of goldens) {
      const s = ratingScore(g.h, g.tp, g.kt / 1.943844, g.wd, g.sn, g.sd);
      const l = scoreToLevel(s);
      if (l !== g.l) levelDrift.push({ ...g, js_s: s, js_l: l });
      if (Math.abs(s - g.s) > ROUNDING_UNIT + 1e-9) scoreDrift.push({ ...g, js_s: s });
    }
    if (levelDrift.length || scoreDrift.length) {
      // eslint-disable-next-line no-console
      console.error('PARITY DRIFT', JSON.stringify({ levelDrift: levelDrift.slice(0, 5), scoreDrift: scoreDrift.slice(0, 5) }, null, 1));
    }
    expect(levelDrift).toHaveLength(0);
    expect(scoreDrift).toHaveLength(0);
  });

  test('the rounding artefact stays bounded — a jump means the engines really diverged', () => {
    let differing = 0;
    let maxDelta = 0;
    for (const g of goldens) {
      const d = Math.abs(ratingScore(g.h, g.tp, g.kt / 1.943844, g.wd, g.sn, g.sd) - g.s);
      if (d > 1e-9) differing += 1;
      maxDelta = Math.max(maxDelta, d);
    }
    expect(maxDelta).toBeLessThanOrEqual(ROUNDING_UNIT + 1e-9);
    expect(differing / goldens.length).toBeLessThan(0.05); // measured 1.27%
  });

  test('the golden set actually covers the interesting space', () => {
    expect(goldens.length).toBeGreaterThan(4000);
    expect(new Set(goldens.map((g) => g.l)).size).toBeGreaterThanOrEqual(5);
    expect(goldens.some((g) => g.s === 0)).toBe(true);
    expect(goldens.some((g) => g.s > 70)).toBe(true);
  });
});

import { mapSpotRatingsResponse } from './spotRatingsClient';
import { RATING_COLOR, RATING_LABEL } from './surfRating';

describe('mapSpotRatingsResponse', () => {
  it('maps a rated spot to the glyph shape, keyed by spot_id', () => {
    const out = mapSpotRatingsResponse([
      { spot_id: 'uuid-a', score: 72.4, level: 'good', confidence: 'high', why: 'clean 12s', surf_height_m: 1.83, period_s: 12.4,
        tide: { height_m: -0.06, norm: 0.74, trend: 'falling' } },
    ]);
    expect(out['uuid-a']).toEqual({
      score: 72,                       // rounded
      level: 'good',
      color: RATING_COLOR['good'],
      label: RATING_LABEL['good'],
      confidence: 'high',
      surfHeightM: 1.83,               // carried for the hover (live surf height)
      periodS: 12.4,
      tide: { height_m: -0.06, norm: 0.74, trend: 'falling' },   // carried for the card's tide line
      why: 'clean 12s',
      // ⭐ ADDED 2026-08-05 — and this exact-shape assertion is WHY the addition is safe to make.
      // `toEqual` on the whole object means a field cannot be added to the mapper without landing
      // here, so the glyph's payload shape can never drift silently. That is the property the three
      // /point whitelists lacked for eight repetitions of this defect. See the fourth-whitelist
      // block at the end of this file for what these three carry and why they are null here.
      directionalConflict: null,
      modelAgreement: null,
      geometryReadiness: null,
      source: 'endpoint',
    });
  });

  it('carries null surf height/period/tide when the endpoint omits them', () => {
    const out = mapSpotRatingsResponse([{ spot_id: 'x', score: 40, level: 'fair' }]);
    expect(out.x.surfHeightM).toBeNull();
    expect(out.x.periodS).toBeNull();
    expect(out.x.tide).toBeNull();
  });

  it('skips unrated spots (null score) — they fall back to a plain pin', () => {
    const out = mapSpotRatingsResponse([
      { spot_id: 'rated', score: 30, level: 'poor' },
      { spot_id: 'flat', score: null, level: 'unknown' },
      { spot_id: 'missing', level: 'fair' },           // no score field
    ]);
    expect(out.rated).toBeDefined();
    expect(out.flat).toBeUndefined();
    expect(out.missing).toBeUndefined();
  });

  it('skips entries without a spot_id and tolerates bad input', () => {
    expect(mapSpotRatingsResponse([{ score: 50, level: 'fair' }])).toEqual({});
    expect(mapSpotRatingsResponse(null)).toEqual({});
    expect(mapSpotRatingsResponse(undefined)).toEqual({});
    expect(mapSpotRatingsResponse('nope')).toEqual({});
  });

  it('defaults level to unknown and confidence to low when absent', () => {
    const out = mapSpotRatingsResponse([{ spot_id: 'x', score: 10 }]);
    expect(out.x.level).toBe('unknown');
    expect(out.x.confidence).toBe('low');
  });
});

// ── ⛔ THE FOURTH POINT WHITELIST (added 2026-08-05) ─────────────────────────────────────────────
//
// `pointFieldWhitelistParity.test.js` guards the THREE /point mappers. This file is a fourth
// whitelist, one layer downstream, and nothing watched it: `mapSpotRatingsResponse` rebuilds every
// spot field-by-field, so a field the backend computes correctly is dropped here silently.
// `SpotRatingItem` (backend/routes/weather.py) declares 20 fields; this mapper emitted 10.
//
// That is the same defect class the backend model's own comment records — "A FIELD IS NOT SHIPPED
// UNTIL A TEST ASSERTS IT SURVIVES SERIALISATION" — repeating at the render boundary instead of the
// Pydantic one. `directional_conflict` shipped to the payload on the very day this mapper was
// found dropping it: the caveat reached the wire and died one line short of the glyph.
//
// ★ These assertions are about REACHABILITY, not rendering. No component reads these yet (neither
//   does anything read `model_agreement`). Carrying them is what makes rendering a product
//   decision rather than a backend change.

describe('the fourth whitelist carries the diagnostic fields', () => {
  const spot = (over = {}) => ({
    spot_id: 's1', score: 42.0, level: 'fair', confidence: 'medium',
    surf_height_m: 1.2, period_s: 11.0, why: '~4 ft surf', ...over,
  });

  test('directional_conflict survives the mapper', () => {
    const block = {
      reason: 'size_and_quality_disagree_on_swell_exposure',
      quality_exposure: 0.1, height_exposure_factor: 0.595, energy_disagreement: 3.54,
    };
    const out = mapSpotRatingsResponse([spot({ directional_conflict: block })]);
    expect(out.s1.directionalConflict).not.toBeNull();
    expect(out.s1.directionalConflict.energy_disagreement).toBe(3.54);
  });

  test('model_agreement and geometry_readiness survive the mapper', () => {
    const out = mapSpotRatingsResponse([spot({
      model_agreement: { n_models: 3, spread: 2.7, agreement: 'tight' },
      geometry_readiness: 'degraded',
    })]);
    expect(out.s1.modelAgreement.agreement).toBe('tight');
    expect(out.s1.geometryReadiness).toBe('degraded');
  });

  test('ABSENT stays absent — the caveat must not appear on every spot', () => {
    // directional_conflict is null on ~85% of spots BY DESIGN (it fires only past 75.73 deg).
    const out = mapSpotRatingsResponse([spot()]);
    expect(out.s1.directionalConflict).toBeNull();
    expect(out.s1.modelAgreement).toBeNull();
  });

  test('the mapper still DROPS an unknown field__THE_CONTROL', () => {
    // Without this, the three assertions above could pass on a mapper that had been changed to
    // spread `...sp` wholesale — which would carry the fields but stop being a whitelist, and the
    // next reader would have no way to tell the difference.
    const out = mapSpotRatingsResponse([spot({ a_field_nobody_maps: 'value' })]);
    expect(out.s1.a_field_nobody_maps).toBeUndefined();
  });
});

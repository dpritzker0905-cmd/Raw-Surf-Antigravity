/**
 * PROOF: the per-layer forecast-window cap is INOPERATIVE for three layers (2026-08-09).
 *
 * `resolveForecastWindow` narrows a tier's allowed days by the backend capability rows: filter by
 * `layer`, else by `domain`, else — silently — keep the WHOLE model's rows and take the max over
 * all of them. Three frontend layer ids match neither filter, so their own cap never binds:
 *
 *   frontend id   capability `layer`      matches?
 *   rain          "precipitation"         NO  (different word for the same thing)
 *   temperature   (no row at all)         NO
 *   water_temp    (no row at all)         NO
 *   domains are only marine | weather | wind, so the second filter rescues none of them.
 *
 * WHY IT MATTERS, and why it is not a cosmetic mismatch: the max is taken across every layer of
 * that model, so ICON's marine estimated extension (336 h) becomes the cap for ICON RAIN, whose
 * own row says 168 h. The scrubber then offers 14 days for a layer that carries 7.
 *
 * ⚠️ THIS COMPOSES WITH THE STALE-FRAME DEFECT (staleHour.proof.test.js). The resolver lets a user
 * ASK for hours the layer does not have; the tile lane then clamps to the last available frame and
 * PAINTS it under the requested hour. One defect opens the door, the other walks through it. The
 * disclosure shipped in modelProvenance.describeStaleHour is what now says so on screen — it
 * mitigates the symptom, it does not close this hole.
 *
 * ⛔ NO BEHAVIOUR IS CHANGED HERE, DELIBERATELY. Making the cap bind would REDUCE the advertised
 * window (ICON rain 14 d -> 7 d). That is a product decision about what users may reach, not a
 * refactor, so it is the owner's call. This file exists so the decision is made on measurement.
 */
import { resolveForecastWindow } from './LayerAccessResolver';

// A realistic ICON row set: the marine extension advertises 336 h, precipitation only 168 h.
const ICON_CAPS = [
  { model: 'ICON', layer: 'precipitation', domain: 'weather', max_forecast_hours: 168 },
  { model: 'ICON', layer: 'fog', domain: 'weather', max_forecast_hours: 168 },
  { model: 'ICON', layer: 'wind', domain: 'wind', max_forecast_hours: 168 },
  { model: 'ICON', layer: 'waves', domain: 'marine', max_forecast_hours: 336 },
  { model: 'ICON', layer: 'swell_1', domain: 'marine', max_forecast_hours: 336 },
];

// ⚠️ Two assumptions I got wrong here, both caught by the CONTROL below rather than by reading:
//  1. resolveForecastWindow returns a NUMBER, not an object with .forecastDays.
//  2. getUserTier reads subscriptionTier / subscription_tier / tier_id — NOT `tier` — so a
//     `{ tier: 'premium' }` object silently resolves to GUEST (3 days) and every assertion would
//     have been measuring the guest cap while claiming to measure premium. It takes a plain
//     string too, which is unambiguous, so that is what this uses.
const PREMIUM = 'premium';                    // 14 days before any capability cap applies

beforeEach(() => { window.__WEATHER_CAPABILITIES__ = ICON_CAPS; });
afterEach(() => { delete window.__WEATHER_CAPABILITIES__; });

const days = (layer) => resolveForecastWindow(PREMIUM, 'ICON', layer);

describe('the per-layer cap binds only when the layer NAME matches', () => {
  it('CONTROL — a matching id does bind: fog is capped at its own 168 h = 7 days', () => {
    // Without this control the test below could pass on a resolver that ignores capabilities
    // entirely, and would be proving nothing at all.
    expect(days('fog')).toBe(7);
  });

  it('CONTROL — marine keeps its longer window (the cap is a min, not a clamp to the shortest)', () => {
    expect(days('waves')).toBe(14);
  });

  it('⚠️ THE DEFECT: `rain` matches no layer and no domain, so ICON marine\'s 336 h caps it', () => {
    // The backend row for this data says 168 h. The user is offered 14 days of it.
    expect(days('rain')).toBe(14);
    expect(days('rain')).not.toBe(7);
  });

  it('⚠️ same for `temperature` and `water_temp`, which have no capability row at all', () => {
    expect(days('temperature')).toBe(14);
    expect(days('water_temp')).toBe(14);
  });

  it('the mismatch is the NAME, not the mechanism — renaming the id fixes it', () => {
    // Proof that nothing else is wrong: ask under the capability's own word and the cap binds.
    expect(days('precipitation')).toBe(7);
  });

  it('every OTHER frontend layer id does match a capability row (scope is exactly three)', () => {
    // Guards against over-claiming: an earlier reading of this defect listed `satellite` too.
    const capLayers = new Set(['fog', 'precipitation', 'pressure', 'radar', 'satellite',
                               'swell_1', 'swell_2', 'waves', 'wind', 'wind_waves']);
    const frontendIds = ['rain', 'radar', 'satellite', 'pressure', 'temperature', 'water_temp',
                         'fog', 'wind', 'waves', 'swell_1', 'swell_2', 'wind_waves'];
    const unmatched = frontendIds.filter((id) => !capLayers.has(id));
    expect(unmatched.sort()).toEqual(['rain', 'temperature', 'water_temp']);
  });
});


// ── THE OPT-IN FIX (default OFF = byte-identical) ────────────────────────────────────────────
describe('__RAW_LAYER_CAP_ALIAS__ makes the per-layer cap bind for `rain`', () => {
  afterEach(() => { delete window.__RAW_LAYER_CAP_ALIAS__; });

  it('DEFAULT OFF keeps today behaviour exactly -- rain still reaches 14 days', () => {
    // Shipping dark: nobody loses a week of forecast until the owner decides they should.
    expect(days('rain')).toBe(14);
  });

  it('ON, rain is capped by its OWN row (168 h = 7 days)', () => {
    window.__RAW_LAYER_CAP_ALIAS__ = true;
    expect(days('rain')).toBe(7);
  });

  it('ON, nothing else moves -- the alias is not a blanket re-match', () => {
    window.__RAW_LAYER_CAP_ALIAS__ = true;
    expect(days('fog')).toBe(7);        // already matched by name; unchanged
    expect(days('waves')).toBe(14);     // marine keeps its longer window
  });

  it('⚠️ temperature and water_temp are UNFIXED, and deliberately so', () => {
    // They have NO capability row, so there is no per-layer bound to apply; aliasing them would
    // invent one. Measured, not assumed -- see the layer/domain census above.
    window.__RAW_LAYER_CAP_ALIAS__ = true;
    expect(days('temperature')).toBe(14);
    expect(days('water_temp')).toBe(14);
  });

  it('only an EXACT true flips it', () => {
    window.__RAW_LAYER_CAP_ALIAS__ = 'yes';
    expect(days('rain')).toBe(14);
  });
});

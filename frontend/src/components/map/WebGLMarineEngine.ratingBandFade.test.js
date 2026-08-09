import { resolveRatingBandFade } from './WebGLMarineEngine';

// The rating band's zoom-out cross-fade (2026-07-12, coastal-ribbon spec zoom-out half): the band
// must TRADE PLACES with the honest heatmap across a viewport-span window ending just before the
// mid→global tier boundary (request span 15°, ≈9.5° viewport before the fetch pad) — not hard-drop
// at the handoff. bandMult multiplies the main-pass opacity while it paints rating colors;
// washStrength replaces the blend-base dim factor (0.72 default) so the honest wash rises in step.

const IDENT = { bandMult: 1.0, washStrength: null, fade: 1.0, spanFade: 1.0, covFade: 1.0 };

describe('resolveRatingBandFade — band⇄heatmap trade at the tier boundary', () => {
  it('IDENTITY when the band is not painting (honest frames are never faded)', () => {
    expect(resolveRatingBandFade(12.0, false, true, {})).toEqual(IDENT);
  });

  it('IDENTITY under the kill switch (__RAW_RATING_ZOOM_FADE_DISABLED__ restores hard on/off)', () => {
    expect(resolveRatingBandFade(12.0, true, true, { __RAW_RATING_ZOOM_FADE_DISABLED__: true })).toEqual(IDENT);
  });

  it('FAILS OPEN on an unknown/degenerate viewport span (null, 0, non-number)', () => {
    expect(resolveRatingBandFade(null, true, true, {})).toEqual(IDENT);
    expect(resolveRatingBandFade(0, true, true, {})).toEqual(IDENT);
    expect(resolveRatingBandFade(undefined, true, true, {})).toEqual(IDENT);
  });

  it('FULL band below the window (close surf zooms): bandMult 1, wash stays at its dimmed default', () => {
    const r = resolveRatingBandFade(3.0, true, true, {});
    expect(r.fade).toBe(1.0);
    expect(r.bandMult).toBe(1.0);
    expect(r.washStrength).toBeCloseTo(0.72, 5);   // fade=1 → base dim unchanged
  });

  it('BAND GONE at/beyond the window top with a wash under it: bandMult 0, wash at FULL strength', () => {
    const r = resolveRatingBandFade(9.5, true, true, {});
    expect(r.fade).toBe(0.0);
    expect(r.bandMult).toBe(0.0);
    expect(r.washStrength).toBeCloseTo(1.0, 5);    // honest field at ≈committed strength → invisible swap
    const wider = resolveRatingBandFade(40.0, true, true, {});
    expect(wider.bandMult).toBe(0.0);
    expect(wider.washStrength).toBeCloseTo(1.0, 5);
  });

  it('MIDPOINT of the window: smoothstep half-fade, wash half-lifted', () => {
    const r = resolveRatingBandFade(7.75, true, true, {});   // midpoint of 6.0..9.5
    expect(r.fade).toBeCloseTo(0.5, 5);
    expect(r.bandMult).toBeCloseTo(0.5, 5);
    expect(r.washStrength).toBeCloseTo(0.72 + 0.28 * 0.5, 5);
  });

  it('FLOORS at 0.3 when NO wash is engaged (a fully-faded band over a washless viewport = blank-map bug)', () => {
    const r = resolveRatingBandFade(12.0, true, false, {});
    expect(r.fade).toBe(0.0);
    expect(r.bandMult).toBe(0.3);
  });

  it('respects the span levers (__RAW_RATING_SPAN_FADE_LO__/HI__ move the window)', () => {
    const win = { __RAW_RATING_SPAN_FADE_LO__: 10.0, __RAW_RATING_SPAN_FADE_HI__: 20.0 };
    expect(resolveRatingBandFade(9.0, true, true, win).bandMult).toBe(1.0);   // below the moved window
    expect(resolveRatingBandFade(20.0, true, true, win).bandMult).toBe(0.0);  // at its top
    expect(resolveRatingBandFade(15.0, true, true, win).fade).toBeCloseTo(0.5, 5);
  });

  it('wash lift builds on the __RAW_BLEND_BASE_WASH__ lever, not a hardcoded 0.72', () => {
    const win = { __RAW_BLEND_BASE_WASH__: 0.5 };
    const full = resolveRatingBandFade(3.0, true, true, win);
    expect(full.washStrength).toBeCloseTo(0.5, 5);                            // fade=1 → lever value
    const gone = resolveRatingBandFade(9.5, true, true, win);
    expect(gone.washStrength).toBeCloseTo(1.0, 5);                            // fade=0 → full either way
  });

  it('fade is monotonic non-increasing across the window (no flicker-inducing reversals)', () => {
    let prev = Infinity;
    for (let s = 5.0; s <= 11.0; s += 0.25) {
      const { fade } = resolveRatingBandFade(s, true, true, {});
      expect(fade).toBeLessThanOrEqual(prev + 1e-12);
      prev = fade;
    }
  });
});

// COVERAGE LEG (2026-07-16 §2c): the release is `z ≤ MARINE_ZOOMED_OUT_MAX_ZOOM (7.0) && coverage
// < __RAW_DOWNGRADE_COVER_FRAC__ (0.6)` — on real zoom-outs it fires around span 5-6°, before the
// span window has ramped, so the world bridge swapped in under a full-strength band (zoomlab
// real-wheel trace, +11-16 L). The coverage leg fades the band toward 0 as coverage falls to the
// release lever, engaged only as z nears the release's own zoom boundary.
describe('resolveRatingBandFade — coverage leg (band gone BEFORE the wide-view release)', () => {
  const at = (span, cov, extras) => resolveRatingBandFade(span, true, true, extras || {}, cov);

  it('INERT without coverage input (backward compatible: all span-only behavior above unchanged)', () => {
    expect(at(3.0, undefined).fade).toBe(1.0);
    expect(at(3.0, {}).covFade).toBe(1.0);
    expect(at(3.0, { coverFrac: null, zoom: null }).covFade).toBe(1.0);
  });

  it('INERT above the zoom lead window: a z10 coastal pan with low coverage never dims the band', () => {
    const r = at(0.4, { coverFrac: 0.3, zoom: 10.0 });
    expect(r.covFade).toBe(1.0);
    expect(r.bandMult).toBe(1.0);   // grace territory — rated→rated handoffs, band must not breathe
  });

  it('FULL coverage keeps the band regardless of zoom (settled covering rated resident at z6.8)', () => {
    const r = at(3.0, { coverFrac: 1.0, zoom: 6.8 });
    expect(r.covFade).toBeCloseTo(1.0, 5);
    expect(r.bandMult).toBeCloseTo(1.0, 5);
  });

  it('AT the release conjunction (z ≤ 7, coverage at the 0.6 lever): band fully faded, wash at full', () => {
    const r = at(5.5, { coverFrac: 0.6, zoom: 6.95 });
    expect(r.covFade).toBeCloseTo(0.0, 5);
    expect(r.bandMult).toBeCloseTo(0.0, 5);      // the swap frame paints under an already-gone band
    expect(r.washStrength).toBeCloseTo(1.0, 5);  // trade-places invariant holds on the coverage leg too
  });

  it('LEAD ramp: mid lead-window + mid coverage gives a partial fade (anticipation, not a snap)', () => {
    const r = at(5.0, { coverFrac: 0.7, zoom: 7.25 });
    expect(r.covFade).toBeGreaterThan(0.05);
    expect(r.covFade).toBeLessThan(0.95);
    expect(r.fade).toBe(r.covFade);              // span 5.0 is below the span window → coverage leg drives
  });

  it('monotonic: fade never INCREASES as coverage drops or as z descends toward the boundary', () => {
    let prev = Infinity;
    for (let c = 1.0; c >= 0.55; c -= 0.05) {
      const { covFade } = at(5.0, { coverFrac: c, zoom: 7.1 });
      expect(covFade).toBeLessThanOrEqual(prev + 1e-12);
      prev = covFade;
    }
    prev = Infinity;
    for (let zz = 8.0; zz >= 6.5; zz -= 0.1) {
      const { covFade } = at(5.0, { coverFrac: 0.62, zoom: zz });
      expect(covFade).toBeLessThanOrEqual(prev + 1e-12);
      prev = covFade;
    }
  });

  it('combines with the span leg via min(): whichever fade is lower wins, wash follows the combo', () => {
    const spanDriven = at(9.0, { coverFrac: 1.0, zoom: 6.8 });     // span ~gone, coverage full
    expect(spanDriven.fade).toBeCloseTo(spanDriven.spanFade, 5);
    const covDriven = at(5.0, { coverFrac: 0.6, zoom: 6.8 });      // span full, coverage at release
    expect(covDriven.fade).toBeCloseTo(0.0, 5);
    expect(covDriven.washStrength).toBeCloseTo(1.0, 5);
  });

  it('COUPLES to the release lever: raising __RAW_DOWNGRADE_COVER_FRAC__ moves the coverage ramp', () => {
    const win = { __RAW_DOWNGRADE_COVER_FRAC__: 0.8 };
    const r = resolveRatingBandFade(5.0, true, true, win, { coverFrac: 0.8, zoom: 6.9 });
    expect(r.covFade).toBeCloseTo(0.0, 5);       // at the (moved) release boundary → band gone
    const still = resolveRatingBandFade(5.0, true, true, {}, { coverFrac: 0.8, zoom: 6.9 });
    expect(still.covFade).toBeGreaterThan(0.5);  // default lever: 0.8 coverage is comfortably covering
  });

  it('kill switch __RAW_DISABLE_BAND_COVER_FADE__ disables ONLY the coverage leg (span leg stands)', () => {
    const win = { __RAW_DISABLE_BAND_COVER_FADE__: true };
    const r = resolveRatingBandFade(5.0, true, true, win, { coverFrac: 0.3, zoom: 6.8 });
    expect(r.covFade).toBe(1.0);
    expect(r.bandMult).toBe(1.0);
    const spanStill = resolveRatingBandFade(9.5, true, true, win, { coverFrac: 0.3, zoom: 6.8 });
    expect(spanStill.bandMult).toBe(0.0);
  });

  it('washless floor still applies on the coverage leg (blank-map lesson: never below 0.3 washless)', () => {
    const r = resolveRatingBandFade(5.0, true, false, {}, { coverFrac: 0.6, zoom: 6.9 });
    expect(r.bandMult).toBe(0.3);
  });

  it('zero zoom lead (__RAW_BAND_COVER_FADE_ZLEAD__: 0) hard-gates the leg at the release boundary', () => {
    const win = { __RAW_BAND_COVER_FADE_ZLEAD__: 0 };
    expect(resolveRatingBandFade(5.0, true, true, win, { coverFrac: 0.6, zoom: 7.05 }).covFade).toBe(1.0);
    expect(resolveRatingBandFade(5.0, true, true, win, { coverFrac: 0.6, zoom: 6.99 }).covFade).toBeCloseTo(0.0, 5);
  });
});

// === THE DEAD ZONE (measured 2026-08-09, queue E#1 sweep) ===================================
// This block pins a KNOWN-DEFECTIVE state deliberately, the way the census pins its two honest
// refusals: the fade's HI (9.5°) was derived from a mid-tier ceiling of 15°, which moved to 40
// and then 400 (mid_res_tier.py:116-143) while the backend simultaneously began RATING the
// mid-res tier (grid_resolver_surf.py:66-71). So across viewport spans 9.5°→40° the backend
// ships a fully rated grid that this function multiplies by zero.
// ⛔ These assertions describe what SHIPS TODAY, not what is right. When the owner re-tunes HI,
// this block MUST be rewritten — it is here so the re-tune is a deliberate act with a visible
// diff, and so nobody re-derives the dead zone from scratch a third time.
describe('resolveRatingBandFade — the 9.5°→40° DEAD ZONE (owner-gated, not yet re-tuned)', () => {
  it('paints a RATED grid at alpha 0 across the whole 9.5-40 deg span range', () => {
    // Every span here is one the backend rates: the rating skip is span >= 350 (backend), and the
    // frontend only globalizes past 40 deg. isRatingPainting=true IS the backend saying "rated".
    for (const span of [9.5, 12, 20, 30, 39.9]) {
      const r = resolveRatingBandFade(span, true, true, {});
      expect(r.bandMult).toBe(0.0);
      expect(r.washStrength).toBeCloseTo(1.0, 5);   // the honest height wash is what the user sees
    }
  });

  it('is still CORRECT past 40 deg — only the endpoint is stale, not the intent', () => {
    // Past the frontend globalize ceiling the served span is ~360 >= 350, so the grid genuinely
    // carries no quality signal and a zero band is the honest answer. A re-tune must not break this.
    const r = resolveRatingBandFade(60, true, true, {});
    expect(r.bandMult).toBe(0.0);
  });

  it('the lever can already close the dead zone without a code change (the kill-switch path)', () => {
    // Evidence for the owner that re-tuning is a one-value experiment, not a rewrite:
    // raising HI to the 40 deg globalize boundary restores the band across the dead zone.
    const win = { __RAW_RATING_SPAN_FADE_HI__: 40.0 };
    expect(resolveRatingBandFade(20, true, true, win).bandMult).toBeGreaterThan(0.3);
    expect(resolveRatingBandFade(39.9, true, true, win).bandMult).toBeCloseTo(0.0, 2);
  });
});

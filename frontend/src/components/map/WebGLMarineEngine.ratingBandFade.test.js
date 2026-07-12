import { resolveRatingBandFade } from './WebGLMarineEngine';

// The rating band's zoom-out cross-fade (2026-07-12, coastal-ribbon spec zoom-out half): the band
// must TRADE PLACES with the honest heatmap across a viewport-span window ending just before the
// mid→global tier boundary (request span 15°, ≈9.5° viewport before the fetch pad) — not hard-drop
// at the handoff. bandMult multiplies the main-pass opacity while it paints rating colors;
// washStrength replaces the blend-base dim factor (0.72 default) so the honest wash rises in step.

const IDENT = { bandMult: 1.0, washStrength: null, fade: 1.0 };

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

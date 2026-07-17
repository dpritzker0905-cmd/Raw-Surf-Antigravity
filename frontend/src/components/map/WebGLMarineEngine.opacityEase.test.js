import { applySharpenOpacityEase } from './WebGLMarineEngine';

// SHARPEN-COMMIT OPACITY EASE (2026-07-17 first-activation swap): a real resident swap (coarse→fine
// sharpen, fine→coarse zoom-out) eases the drawn heatmap opacity from the last-drawn value to the
// new target over ~600ms instead of stepping (the measured +43% one-frame pop). Locks: continuity
// at stamp time, smoothstep midpoint, convergence + expiry, snap-to-hidden (never ghost a hidden
// layer — the flash-chain class), kill switch, custom duration lever, both directions.

const WIN = {};                 // default config
const KILLED = { __RAW_DISABLE_SHARPEN_OPACITY_EASE__: true };

const ease = (from, t0 = 1000) => ({ from, t0 });

describe('applySharpenOpacityEase', () => {
  it('passes the target through when no ease is stamped', () => {
    expect(applySharpenOpacityEase(null, 0.76, 1.0, 1234, WIN)).toEqual({ value: 0.76, ease: null });
  });

  it('kill switch passes the target through and drops the ease', () => {
    const r = applySharpenOpacityEase(ease(0.53), 0.76, 1.0, 1000, KILLED);
    expect(r).toEqual({ value: 0.76, ease: null });
  });

  it('SNAP-TO-HIDDEN: mult 0 (gate-hidden) drops the ease — never ghost-paints a hidden layer', () => {
    expect(applySharpenOpacityEase(ease(0.53), 0.76, 0, 1100, WIN)).toEqual({ value: 0.76, ease: null });
  });

  it('SNAP-TO-HIDDEN: near-zero target drops the ease (heatmap intended invisible)', () => {
    expect(applySharpenOpacityEase(ease(0.53), 0.005, 1.0, 1100, WIN)).toEqual({ value: 0.005, ease: null });
  });

  it('is CONTINUOUS at stamp time: dt=0 draws exactly the last-drawn value', () => {
    const r = applySharpenOpacityEase(ease(0.53, 1000), 0.76, 1.0, 1000, WIN);
    expect(r.value).toBeCloseTo(0.53, 6);
    expect(r.ease).not.toBeNull();
  });

  it('midpoint dt=300/600 is the smoothstep midpoint (halfway between from and target)', () => {
    const r = applySharpenOpacityEase(ease(0.53, 1000), 0.76, 1.0, 1300, WIN);
    expect(r.value).toBeCloseTo(0.53 + (0.76 - 0.53) * 0.5, 6);
    expect(r.ease).not.toBeNull();
  });

  it('converges: dt >= duration returns the target and expires the ease', () => {
    expect(applySharpenOpacityEase(ease(0.53, 1000), 0.76, 1.0, 1600, WIN)).toEqual({ value: 0.76, ease: null });
    expect(applySharpenOpacityEase(ease(0.53, 1000), 0.76, 1.0, 5000, WIN)).toEqual({ value: 0.76, ease: null });
  });

  it('eases DOWN too (fine→coarse zoom-out dim)', () => {
    const r = applySharpenOpacityEase(ease(0.76, 1000), 0.53, 1.0, 1300, WIN);
    expect(r.value).toBeCloseTo(0.76 + (0.53 - 0.76) * 0.5, 6);
  });

  it('honors the duration lever __RAW_SHARPEN_OPACITY_EASE_MS__', () => {
    const w = { __RAW_SHARPEN_OPACITY_EASE_MS__: 200 };
    // at dt=100/200 → smoothstep midpoint
    const mid = applySharpenOpacityEase(ease(0.5, 0), 0.7, 1.0, 100, w);
    expect(mid.value).toBeCloseTo(0.6, 6);
    // at dt=250 > 200 → expired
    expect(applySharpenOpacityEase(ease(0.5, 0), 0.7, 1.0, 250, w)).toEqual({ value: 0.7, ease: null });
  });

  it('a clock anomaly (negative dt) snaps to target rather than easing from a bad stamp', () => {
    expect(applySharpenOpacityEase(ease(0.53, 5000), 0.76, 1.0, 1000, WIN)).toEqual({ value: 0.76, ease: null });
  });

  it('a malformed stamp (no numeric from) snaps to target', () => {
    expect(applySharpenOpacityEase({ from: null, t0: 1000 }, 0.76, 1.0, 1100, WIN)).toEqual({ value: 0.76, ease: null });
  });
});

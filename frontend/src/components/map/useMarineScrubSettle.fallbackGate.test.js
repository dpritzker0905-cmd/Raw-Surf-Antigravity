/**
 * R11-01(b) (Report 11.0) — the engine-empty backstop leg stands down in guardrail-fallback
 * mode. THE LOOP THIS CLOSES: guardrail flips webglMarineFailed -> WebGLMarineLayer unmounts,
 * engine.dispose() nulls _waveData -> the 1 s backstop reads "engine empty + idle >=3 s" and
 * re-drives every ~6 s, unbounded (the clamp leg has a 3-strike cap, a 45 s probe cadence, a
 * 4-probe budget and a terminal state; the engine-empty leg had none), while the raster+canvas
 * fallback renders a perfectly good display on top. Nothing in the backstop consulted the
 * guardrail — grep found zero references. The suppression predicate is pure so this class is
 * testable without mounting the hook.
 */
import { marineFallbackSuppressesEmptyRedrive } from './useMarineScrubSettle';

describe('marineFallbackSuppressesEmptyRedrive — the churn-loop gate', () => {
  it('suppresses while the guardrail has marine flipped to fallback (the loop condition)', () => {
    expect(marineFallbackSuppressesEmptyRedrive({
      __WEBGL_GUARDRAIL_FALLBACK__: { webglMarineFailed: true, webglWindFailed: false },
    })).toBe(true);
  });

  it('does NOT suppress in the healthy WebGL path — the backstop keeps healing real wedges', () => {
    expect(marineFallbackSuppressesEmptyRedrive({
      __WEBGL_GUARDRAIL_FALLBACK__: { webglMarineFailed: false, webglWindFailed: false },
    })).toBe(false);
  });

  it('a WIND-only fallback does not silence the MARINE backstop', () => {
    expect(marineFallbackSuppressesEmptyRedrive({
      __WEBGL_GUARDRAIL_FALLBACK__: { webglMarineFailed: false, webglWindFailed: true },
    })).toBe(false);
  });

  it('does NOT suppress when the guardrail handle is absent (boot, unmounted map)', () => {
    expect(marineFallbackSuppressesEmptyRedrive({})).toBe(false);
    expect(marineFallbackSuppressesEmptyRedrive(null)).toBe(false);
    expect(marineFallbackSuppressesEmptyRedrive(undefined)).toBe(false);
  });

  it('kill switch restores the old always-on behavior', () => {
    expect(marineFallbackSuppressesEmptyRedrive({
      __RAW_BACKSTOP_IGNORE_GUARDRAIL__: true,
      __WEBGL_GUARDRAIL_FALLBACK__: { webglMarineFailed: true },
    })).toBe(false);
  });

  it('only a literal true counts — truthy junk on the flag does not suppress', () => {
    expect(marineFallbackSuppressesEmptyRedrive({
      __WEBGL_GUARDRAIL_FALLBACK__: { webglMarineFailed: 'yes' },
    })).toBe(false);
  });
});

/**
 * R11-09 (Report 11.0) — wind pool sizing joins the device-capability tier. The one-shot
 * `window.innerWidth < 768` in WebGLWindLayer was the exact defect deviceTier.js documents
 * being live-caught for marine on 2026-07-02 (a desktop with a momentarily narrow window kept
 * the 4x sparser pool for the engine's lifetime) — never mirrored to wind until now.
 */
import { getWindParticleRes, getMarineParticleRes } from './deviceTier';

describe('getWindParticleRes — device tier, never window width', () => {
  const setUA = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });

  afterEach(() => setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'));

  it('desktop UA gets the full 384 pool regardless of window width', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    window.innerWidth = 500; // narrow window must NOT demote the tier
    expect(getWindParticleRes()).toBe(384);
  });

  it('handheld UA gets the 192 pool', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(getWindParticleRes()).toBe(192);
  });

  it('wind and marine tiers agree on WHICH devices are handheld', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    expect(getWindParticleRes()).toBe(192);
    expect(getMarineParticleRes()).toBe(192);
  });
});

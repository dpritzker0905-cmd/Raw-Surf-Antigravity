import { shouldCarryParticlesOnGridSwap } from '../components/map/WebGLMarineEngineInit';

// PARTICLE CARRY (2026-07-06, Part 9 ② of the zoom-out ladder — the z7→z5.7 "animations clamp
// then clear then rebuild from the bottom" report): particle positions live in TILE/MERCATOR
// space, not data-grid space, so a grid bounds/dims swap must CARRY the evolved positions
// instead of reseeding. The advect shader's own land/OOB/drop respawn absorbs particles the
// new grid can't advect. Frame-semantics reinits (tile re-anchor, tileZoomMin crossing) are
// unaffected — they reseed via reinitParticles, not this path.

// DEFAULT ON (2026-07-13, round-12 §2b reseed-blink arc): the 2026-07-06 land-sitting
// regression that kept this opt-in was RE-TESTED LIVE on the deployed engine across all three
// swap classes (fine→coarse zoom-out, coarse→fine zoom-in, coastal pan re-anchors) with zero
// land-sitting — ADVECT_FS drops a particle whose CURRENT position samples land, so carried
// land-sitters cull within one advect frame. Kill switch: __RAW_DISABLE_PARTICLE_CARRY__ = true.
describe('shouldCarryParticlesOnGridSwap (grid-swap particle carry — default ON)', () => {
  it('carries by default (kills the reseed blink on every tier swap)', () => {
    expect(shouldCarryParticlesOnGridSwap({}, true, true)).toBe(true);
    expect(shouldCarryParticlesOnGridSwap(null, true, true)).toBe(true);
  });

  it('never carries when a state texture is missing (init path must still seed)', () => {
    expect(shouldCarryParticlesOnGridSwap({}, false, true)).toBe(false);
    expect(shouldCarryParticlesOnGridSwap({}, true, false)).toBe(false);
  });

  it('kill switch __RAW_DISABLE_PARTICLE_CARRY__ restores the legacy full reseed', () => {
    expect(shouldCarryParticlesOnGridSwap({ __RAW_DISABLE_PARTICLE_CARRY__: true }, true, true)).toBe(false);
  });

  it('non-true kill values keep the carry on (strict === true, no accidental kills)', () => {
    expect(shouldCarryParticlesOnGridSwap({ __RAW_DISABLE_PARTICLE_CARRY__: 1 }, true, true)).toBe(true);
    expect(shouldCarryParticlesOnGridSwap({ __RAW_DISABLE_PARTICLE_CARRY__: undefined }, true, true)).toBe(true);
  });
});

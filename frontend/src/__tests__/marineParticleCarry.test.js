import { shouldCarryParticlesOnGridSwap } from '../components/map/WebGLMarineEngineInit';

// PARTICLE CARRY (2026-07-06, Part 9 ② of the zoom-out ladder — the z7→z5.7 "animations clamp
// then clear then rebuild from the bottom" report): particle positions live in TILE/MERCATOR
// space, not data-grid space, so a grid bounds/dims swap must CARRY the evolved positions
// instead of reseeding. The advect shader's own land/OOB/drop respawn absorbs particles the
// new grid can't advect. Frame-semantics reinits (tile re-anchor, tileZoomMin crossing) are
// unaffected — they reseed via reinitParticles, not this path.

// DEFAULT OFF (2026-07-06 live regression: carried particles from a coarse-mask era sat on
// fine-mask land — near-zero field velocity means the advect shader's next-position land check
// never fires, and the old reseed was silently doubling as the land sweep). Opt-in via
// __RAW_ENABLE_PARTICLE_CARRY__ until the carry gains a swap-time land cull.
describe('shouldCarryParticlesOnGridSwap (grid-swap particle carry — opt-in)', () => {
  it('does NOT carry by default (old reseed behavior; the reseed is also the land sweep)', () => {
    expect(shouldCarryParticlesOnGridSwap({}, true, true)).toBe(false);
    expect(shouldCarryParticlesOnGridSwap(null, true, true)).toBe(false);
  });

  it('never carries when a state texture is missing (init path must still seed)', () => {
    expect(shouldCarryParticlesOnGridSwap({ __RAW_ENABLE_PARTICLE_CARRY__: true }, false, true)).toBe(false);
    expect(shouldCarryParticlesOnGridSwap({ __RAW_ENABLE_PARTICLE_CARRY__: true }, true, false)).toBe(false);
  });

  it('opt-in lever __RAW_ENABLE_PARTICLE_CARRY__ enables the carry for tuning', () => {
    expect(shouldCarryParticlesOnGridSwap({ __RAW_ENABLE_PARTICLE_CARRY__: true }, true, true)).toBe(true);
  });

  it('non-true lever values stay on the reseed path', () => {
    expect(shouldCarryParticlesOnGridSwap({ __RAW_ENABLE_PARTICLE_CARRY__: 1 }, true, true)).toBe(false);
    expect(shouldCarryParticlesOnGridSwap({ __RAW_ENABLE_PARTICLE_CARRY__: undefined }, true, true)).toBe(false);
  });
});

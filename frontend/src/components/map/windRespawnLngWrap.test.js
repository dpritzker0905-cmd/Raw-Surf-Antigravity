/**
 * WIND SEAM AT lng 180 — the viewport-respawn longitude clamp (2026-07-23).
 *
 * Rooted by live measurement, not inference. ADVECT_FS's viewport-biased respawn lane did:
 *     randLng = mix(vpWest - pad, vpEast + pad, r);
 *     newPos  = vec2((randLng + 180.0) / 360.0, randY);
 * map.getBounds() returns UNWRAPPED longitudes across ±180 (measured live: west −189.3, east
 * −156.2) and the 15% pad widens that further, so randLng routinely leaves [−180,180]; newPos.x
 * then leaves [0,1] and encodePos() CLAMPS it — pinning every overflowing respawn to exactly
 * x=0 or x=1. Both edges render on the SAME on-screen meridian, so the two pinned stacks land
 * on one line: the seam.
 *
 * Live GPU read-back of the particle texture at centre 180, edge-bin share vs the uniform
 * mid-mean, scaling with the viewport-bias fraction (the mechanism's own parameter):
 *     z3.2 bias 0.000 →  1.2x      z4.5 bias 0.142 → 11.8x      z5.5 bias 0.400 → 50.6x
 * At z5.5 that is 23% of ALL 147,456 particles stacked on the two edge bins.
 *
 * These tests mirror the shader's respawn arithmetic in JS and assert the REAL invariant — the
 * fraction of respawns that get CLAMPED — rather than asserting a string is present in the
 * source. (The 3°-scramble lesson: assert the invariant, not the metadata.)
 */
import { ADVECT_FS } from './WebGLWindShaders';

// Faithful JS mirror of the shader's viewport-respawn longitude → particle-x mapping.
// `wrap` mirrors u_respawn_lng_wrap.
function respawnX(vpWest, vpEast, r, wrap) {
  const padLng = (vpEast - vpWest) * 0.15;
  let randLng = (vpWest - padLng) + ((vpEast + padLng) - (vpWest - padLng)) * r;
  if (wrap) {
    // GLSL mod(x,y) = x - y*floor(x/y) — always returns a non-negative result for positive y
    const m = (randLng + 180.0) - 360.0 * Math.floor((randLng + 180.0) / 360.0);
    randLng = m - 180.0;
  }
  const x = (randLng + 180.0) / 360.0;
  return { x, clamped: x < 0 || x > 1, stored: Math.min(1, Math.max(0, x)) };
}

function clampedFraction(vpWest, vpEast, wrap, n = 20000) {
  let c = 0;
  for (let i = 0; i < n; i++) if (respawnX(vpWest, vpEast, i / (n - 1), wrap).clamped) c++;
  return c / n;
}

// THE DAM: share of respawns landing on the EXACT endpoints x==0 / x==1. A viewport centred on
// ±180 legitimately puts many particles in the outermost histogram BIN (they are spread across
// its ~1.8° width, which is fine and invisible); what makes a seam is particles collapsed onto a
// single coordinate. That collapse is what encodePos()'s clamp produces, and it is what this
// measures.
function exactEndpointShare(vpWest, vpEast, wrap, n = 20000) {
  let pinned = 0;
  for (let i = 0; i < n; i++) {
    const { stored } = respawnX(vpWest, vpEast, i / (n - 1), wrap);
    if (stored <= 1e-9 || stored >= 1 - 1e-9) pinned++;
  }
  return pinned / n;
}

describe('wind viewport respawn — antimeridian longitude wrap', () => {
  // The live camera that produced the seam: centred on 180, so half the padded respawn range
  // lies beyond ±180 at every zoom (measured fracOutside180 = 0.5).
  const CROSSING = [134.1, 225.9];     // live map.getBounds() at z3.2, centre 180
  const TIGHT_CROSSING = [170.7, 189.3]; // live at z5.5 — the worst measured case

  it('LEGACY clamps a large fraction of respawns at an antimeridian-crossing viewport', () => {
    expect(clampedFraction(...CROSSING, false)).toBeGreaterThan(0.4);
    expect(clampedFraction(...TIGHT_CROSSING, false)).toBeGreaterThan(0.4);
  });

  it('WRAPPED clamps NOTHING — every respawn lands inside [0,1]', () => {
    expect(clampedFraction(...CROSSING, true)).toBe(0);
    expect(clampedFraction(...TIGHT_CROSSING, true)).toBe(0);
  });

  it('LEGACY collapses respawns onto the EXACT ±180 coordinate; WRAPPED does not (the seam)', () => {
    for (const vp of [CROSSING, TIGHT_CROSSING]) {
      const legacy = exactEndpointShare(...vp, false);
      const fixed = exactEndpointShare(...vp, true);
      expect(legacy).toBeGreaterThan(0.4);   // ~half the padded range lies beyond ±180
      expect(fixed).toBeLessThan(0.001);     // nothing pinned — the dam is gone
    }
  });

  it('WRAPPED spreads respawns uniformly over the viewport range (no residual spike)', () => {
    // Bin only over the range the lane actually spawns into, so a viewport centred on ±180 is
    // judged on UNIFORMITY rather than on how much of it happens to sit near the meridian.
    const n = 20000, bins = new Array(64).fill(0);
    for (let i = 0; i < n; i++) {
      // unwrap x back onto a continuous axis centred on the viewport to bin fairly
      const { stored } = respawnX(...TIGHT_CROSSING, i / (n - 1), true);
      const lng = stored * 360 - 180;
      const rel = ((lng - 167.91) % 360 + 360) % 360 / 24.18;   // position within the spawn range
      bins[Math.min(63, Math.max(0, Math.floor(rel * 64)))]++;
    }
    const mean = n / 64;
    const maxBin = Math.max(...bins);
    expect(maxBin).toBeLessThan(mean * 1.6);   // no spike anywhere, including at the meridian
  });

  it('is a NO-OP for a viewport that does not cross ±180 (no regression away from the seam)', () => {
    const florida = [-84, -79];
    expect(clampedFraction(...florida, false)).toBe(0);
    expect(clampedFraction(...florida, true)).toBe(0);
    for (let i = 0; i <= 20; i++) {
      const r = i / 20;
      expect(respawnX(...florida, r, true).x).toBeCloseTo(respawnX(...florida, r, false).x, 10);
    }
  });

  it('wrapped x stays a valid, in-range particle coordinate across extreme bounds', () => {
    for (const [w, e] of [[-540, -180], [170, 550], [-200, -100], [0, 360]]) {
      for (let i = 0; i <= 50; i++) {
        const { x } = respawnX(w, e, i / 50, true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the shader wires the wrap behind its kill-switch uniform', () => {
    expect(ADVECT_FS).toContain('u_respawn_lng_wrap');
    expect(ADVECT_FS).toContain('mod(randLng + 180.0, 360.0) - 180.0');
    // the regional branch must keep its own long-standing wrap
    expect(ADVECT_FS).toContain('mod(u_dataBounds_min.x + randVal.x * spanX + 180.0, 360.0) - 180.0');
  });
});

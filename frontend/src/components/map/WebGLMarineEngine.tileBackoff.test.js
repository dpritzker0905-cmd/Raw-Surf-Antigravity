/**
 * Regression guard for the WIDE-ZOOM PARTICLE-TILE BACKOFF (HANDOFF item B, 2026-07-23).
 *
 * The particle "split" at wide zoom is the fract()-wrap edge of a PARTIAL tile being a geographic
 * discontinuity near the antimeridian. The fix is the WHOLE-WORLD tile (backoff 3 → tileWidth 1.0) at
 * z∈(3,4), which wraps seamlessly. The DISPROVEN naive fix (backoff 1 → tileWidth 0.25) shrank the tile
 * below the viewport margin → the viewport pokes past the tile edge on pan ("EDGE GAP") + 2× reseed-blink.
 *
 * Per the 3°-decimation lesson (a unit test that checked metadata, not the real invariant, let a scrambled
 * grid ship): these tests assert the END-TO-END tile the engine actually renders (backoff → tileZoom →
 * tileWidth → clamp) AND the edge-gap property — not just the backoff number.
 */
import { resolveTileBackoff, clampTileToViewport } from './WebGLMarineEngine';

// Replicate the engine's tile sizing (WebGLMarineEngine render): tileZoom = max(0, floor(z) − backoff),
// tileWidth = 1/2^tileZoom, then the §7i viewport clamp. Returns what the shader actually gets.
function tileFor(z, win, vpW, vpH) {
  const { backoff, mode } = resolveTileBackoff(z, win);
  let tileZoom = Math.max(0, Math.floor(z) - backoff);
  let tileWidth = 1.0 / Math.pow(2.0, tileZoom);
  const c = clampTileToViewport(tileZoom, tileWidth, vpW, vpH);
  // EDGE GAP: on pan the tile re-anchors when |drift| > tileWidth*0.25; it must fire BEFORE the viewport
  // pokes past the tile edge (margin = tileHalf − vpHalf). driftThresh > margin ⇒ a strip with no crests.
  const tileHalf = c.tileWidth / 2, vpHalf = Math.max(vpW, vpH) / 2;
  const edgeGap = (c.tileWidth * 0.25) > (tileHalf - vpHalf);
  return { backoff, mode, tileWidth: c.tileWidth, edgeGap };
}

// Representative non-ultrawide viewport at wide zoom (measured live 2026-07-23 @ z3.5).
const VPW = 0.152, VPH = 0.157;
// Realistic viewport merc-width for a given zoom (≈ screenPx / worldPx, worldPx = 512·2^z, screen ~946px).
const vpForZoom = (z) => 946 / (512 * Math.pow(2, z));

describe('resolveTileBackoff — mode + backoff resolution', () => {
  it('DEFAULT is mode "world": whole-world tile (backoff 3) only in the split zone z∈(3,4)', () => {
    expect(resolveTileBackoff(3.0, {})).toEqual({ backoff: 3, mode: 'world' }); // z>=3
    expect(resolveTileBackoff(3.5, {})).toEqual({ backoff: 3, mode: 'world' });
    expect(resolveTileBackoff(3.99, {})).toEqual({ backoff: 3, mode: 'world' });
    // outside the split zone → the proven pan-stable backoff 2
    expect(resolveTileBackoff(2.99, {})).toEqual({ backoff: 2, mode: 'world' });
    expect(resolveTileBackoff(4.0, {})).toEqual({ backoff: 2, mode: 'world' });
    expect(resolveTileBackoff(4.6, {})).toEqual({ backoff: 2, mode: 'world' }); // the user's clearing zone
    expect(resolveTileBackoff(9, {})).toEqual({ backoff: 2, mode: 'world' });
  });

  it('explicit numeric __RAW_TILE_BACKOFF__ pins and wins over the gate (mode "pin")', () => {
    expect(resolveTileBackoff(3.5, { __RAW_TILE_BACKOFF__: 2 })).toEqual({ backoff: 2, mode: 'pin' });
    expect(resolveTileBackoff(9, { __RAW_TILE_BACKOFF__: 1 })).toEqual({ backoff: 1, mode: 'pin' });
  });

  it('__RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__ forces constant backoff 2 (escape hatch)', () => {
    for (const z of [3.0, 3.5, 3.99, 4.5, 9]) {
      expect(resolveTileBackoff(z, { __RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__: true })).toEqual({ backoff: 2, mode: 'off' });
    }
  });

  it('mode "off" is constant backoff 2 everywhere', () => {
    for (const z of [3.0, 3.5, 4.5, 9]) {
      expect(resolveTileBackoff(z, { __RAW_TILE_BACKOFF_GATE_MODE__: 'off' }).backoff).toBe(2);
    }
  });

  it('mode "dense" (the disproven fix, kept for A/B) uses backoff 1 in z∈(3,5)', () => {
    expect(resolveTileBackoff(3.5, { __RAW_TILE_BACKOFF_GATE_MODE__: 'dense' }).backoff).toBe(1);
    expect(resolveTileBackoff(4.9, { __RAW_TILE_BACKOFF_GATE_MODE__: 'dense' }).backoff).toBe(1);
    expect(resolveTileBackoff(5.0, { __RAW_TILE_BACKOFF_GATE_MODE__: 'dense' }).backoff).toBe(2);
  });
});

describe('END-TO-END tile invariants (the properties that actually matter on screen)', () => {
  it('SPLIT-FIX: default world mode renders the WHOLE-WORLD (seamless) tile across z∈(3,4)', () => {
    for (const z of [3.0, 3.5, 3.99]) {
      const t = tileFor(z, {}, VPW, VPH);
      expect(t.tileWidth).toBe(1.0);   // whole world = no partial-tile edge = no antimeridian split
    }
  });

  it('the pre-fix behavior (off) renders the 0.5 (180°) PARTIAL tile at z∈(3,4) — the split', () => {
    const t = tileFor(3.5, { __RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__: true }, VPW, VPH);
    expect(t.tileWidth).toBe(0.5);
  });

  it('NO-EDGE-GAP: default world mode never gap-clears on pan in the split zone', () => {
    for (const z of [3.0, 3.5, 3.99]) {
      expect(tileFor(z, {}, VPW, VPH).edgeGap).toBe(false);
    }
  });

  it('documents WHY "dense" was rejected: it DOES edge-gap on pan at wide zoom', () => {
    expect(tileFor(3.5, { __RAW_TILE_BACKOFF_GATE_MODE__: 'dense' }, VPW, VPH).edgeGap).toBe(true);
  });

  it('close-zoom is unchanged (backoff 2) and gap-free at every mode (realistic per-zoom viewport)', () => {
    for (const mode of ['world', 'off', 'dense']) {
      for (const z of [5, 7, 9, 12]) {
        const vp = vpForZoom(z);
        const t = tileFor(z, { __RAW_TILE_BACKOFF_GATE_MODE__: mode }, vp, vp);
        expect(t.backoff).toBe(2);
        expect(t.edgeGap).toBe(false);
      }
    }
  });
});

/**
 * THE ISLAND-HALO FIX — the island re-assert's density gate, 1200 -> 400.
 *
 * `reassertNeLand` multiplies coarse Natural Earth land back over the accurate basemap-derived mask
 * (`mask * NE / 255`), so NE land FORCES mask land whatever the basemap says. Where NE's generalized
 * coastline bulges seaward of the real one, the marine field is carved off real water — the island
 * halo. Measured at Madeira z9.30, per bearing, on the deployed build:
 *
 *     leg                       visible band    onset median   worst bearing
 *     stock (gate 1200)            15 px            5 px       75° @ 57 px
 *     re-assert DISABLED            3 px            0 px       255° @ 28 px
 *     gate = 400                    3 px            0 px       255° @ 28 px      <- the fix
 *
 * The waves-OFF baseline is 2 px, so gate=400 returns the coast to the basemap's own edge and
 * reproduces the fully-disabled result exactly — without giving up the re-assert where it earned
 * its place (Abaco 8-17% flooded at a z9 mask of 205 px/deg, re-assert -> 0).
 *
 * These tests pin the SEPARATION the number exists to make. The two named densities on either side
 * of it are real measurements, not round numbers: 205 is the Abaco forensics, ~850 is the viewport
 * overlay (2048 canvas over ~2.4°). If a future change moves the threshold between them, the halo
 * or the flooding comes back, and one of these fails.
 */
import { islandReassertEnabled, ISLAND_REASSERT_MAX_DENSITY } from './WebGLMarineMaskRenderer';

const at = (densityPxPerDeg, over = {}) => islandReassertEnabled({ densityPxPerDeg, ...over });

describe('islandReassertEnabled — the gate that decides whether NE overrides the basemap', () => {
  it('the threshold is 400', () => {
    expect(ISLAND_REASSERT_MAX_DENSITY).toBe(400);
  });

  // ── the two measured regimes the number has to separate ──
  it('ENGAGES on the Abaco regime (205 px/deg) — the coarse mask NE was proven to rescue', () => {
    expect(at(205)).toBe(true);
  });

  it('⭐ does NOT engage on the viewport overlay (~850 px/deg) — the island-halo fix', () => {
    // 2048 canvas over ~2.409 deg. This is the case that measured 15 px of halo at gate 1200.
    expect(at(2048 / 2.409)).toBe(false);
  });

  it('ENGAGES on a world mask (~11 px/deg), where the mask is hopelessly coarser than NE', () => {
    expect(at(4096 / 360)).toBe(true);
  });

  it('does NOT engage on the dense regional base (~1720 px/deg) — unchanged by this fix', () => {
    // 4096 over ~2.381 deg; it was already above the old 1200 gate, so behaviour here is identical.
    expect(at(4096 / 2.381)).toBe(false);
  });

  it('brackets the boundary exactly', () => {
    expect(at(399.9)).toBe(true);
    expect(at(400)).toBe(false);      // strict <, so the threshold itself does not engage
    expect(at(400.1)).toBe(false);
  });

  // ── levers ──
  it('__RAW_DISABLE_ISLAND_REASSERT__ suppresses it even in the coarse regime', () => {
    expect(at(205, { killed: true })).toBe(false);
  });

  it('an explicit maxDensity override wins, in both directions', () => {
    expect(at(850, { maxDensity: 1200 })).toBe(true);    // the OLD behaviour, still reachable
    expect(at(205, { maxDensity: 100 })).toBe(false);
  });

  it('ignores a NaN/absent override rather than disabling itself', () => {
    // the call site passes Number(window.__RAW_...) which is NaN when unset — that must fall back
    // to the default, not to "no re-assert ever".
    expect(at(205, { maxDensity: NaN })).toBe(true);
    expect(at(205, { maxDensity: undefined })).toBe(true);
  });

  // ── an unknown density must not corrupt the mask ──
  it('an unknown or impossible density fails to NOT re-asserting', () => {
    expect(at(0)).toBe(false);
    expect(at(-5)).toBe(false);
    expect(at(NaN)).toBe(false);
    expect(at(Infinity)).toBe(false);
    expect(islandReassertEnabled()).toBe(false);
    expect(islandReassertEnabled(null)).toBe(false);
  });
});

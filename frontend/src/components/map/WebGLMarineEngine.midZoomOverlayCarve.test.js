import { computeMidZoomOverlayEngage, MIDZOOM_OVERLAY_CARVE_MIN_Z } from './WebGLMarineEngine';

// Regression guard for the 2026-07-21 coastal land-bleed halo in the z~8.75–12.13 band (user live
// A/B off John Pennekamp Coral Reef State Park). Jacobian-proven live: across that band the ONLY
// variable that flips the halo on/off is overlayMask.on — at z12.5 the viewport-truth overlay
// engages (min_combine) and the coast is crisply carved; at z10.5 the overlay is gated off (z<12)
// so only the coarse coastline-geojson base mask carves the coast (~186 m/px) and wash bleeds onto
// the coast. computeMidZoomOverlayEngage extends the SAME min-combine down to z>=9, but ONLY when
// the overlay already CONTAINS the viewport (so there is no padded-ring exposure — never a
// REPLACE-style ring flood) and is non-degraded (so min-combine can never punch open-water holes).
// min() only ever REMOVES wash, so engaging it earlier can tighten the coast but never add bleed.

const band = (over = {}) => ({
  z: 10.5, overlayCoversViewport: true, overlayPaintDegraded: false, midCarveOff: false, ...over,
});

describe('computeMidZoomOverlayEngage — mid-zoom coastal carve gate', () => {
  it('ENGAGES in the halo band when the overlay contains the viewport and is non-degraded', () => {
    expect(computeMidZoomOverlayEngage(band())).toBe(true);
  });

  it('ENGAGES exactly at the MIN_Z floor', () => {
    expect(computeMidZoomOverlayEngage(band({ z: MIDZOOM_OVERLAY_CARVE_MIN_Z }))).toBe(true);
  });

  it('does NOT engage below MIN_Z (grid coarsens/covers there — the "covered again" regime)', () => {
    expect(computeMidZoomOverlayEngage(band({ z: MIDZOOM_OVERLAY_CARVE_MIN_Z - 0.5 }))).toBe(false);
    expect(computeMidZoomOverlayEngage(band({ z: 7.5 }))).toBe(false);   // was 8.5; LOP-0003 moved MIN_Z 9->8
  });

  // ⛔ LOP-0003 (2026-08-16) — AN ABSOLUTE PIN, not a relative one. Every other assertion here is
  // written against MIDZOOM_OVERLAY_CARVE_MIN_Z, so they all follow the constant wherever it goes and
  // NONE of them can notice it moving. This one can. LOP-0002 measured the coastline band below the
  // threshold (z8.72/8.90 band PRESENT, z9.30 ABSENT) and LOP-0003 lowered it to 8 so basemap water
  // truth reaches a zoom level further out.
  // ⚠️ The REPAINT COST of that extra level is UNMEASURED and owed. Pinning the number keeps it from
  // drifting while that debt stands.
  it('MIN_Z is 8 — pinned absolutely so a silent move is visible (LOP-0003)', () => {
    expect(MIDZOOM_OVERLAY_CARVE_MIN_Z).toBe(8);
  });

  it('does NOT engage when the overlay does NOT contain the viewport (guards against padded-ring/REPLACE flood)', () => {
    expect(computeMidZoomOverlayEngage(band({ overlayCoversViewport: false }))).toBe(false);
  });

  it('does NOT engage for a degraded overlay (min-combine could otherwise punch open-water holes)', () => {
    expect(computeMidZoomOverlayEngage(band({ overlayPaintDegraded: true }))).toBe(false);
  });

  it('KILL SWITCH (midCarveOff) restores the old z>=12-only behavior — no mid-zoom engagement', () => {
    expect(computeMidZoomOverlayEngage(band({ midCarveOff: true }))).toBe(false);
    // even well inside the band
    expect(computeMidZoomOverlayEngage(band({ midCarveOff: true, z: 11 }))).toBe(false);
  });

  it('fails safe (no engage) when zoom is unknown/non-numeric', () => {
    expect(computeMidZoomOverlayEngage(band({ z: undefined }))).toBe(false);
    expect(computeMidZoomOverlayEngage(band({ z: null }))).toBe(false);
    expect(computeMidZoomOverlayEngage(band({ z: NaN }))).toBe(false);
  });

  it('tolerates a missing/empty opts object without throwing', () => {
    expect(computeMidZoomOverlayEngage()).toBe(false);
    expect(computeMidZoomOverlayEngage({})).toBe(false);
  });

  it('keeps working above z12 too (the band clause is additive, never subtractive)', () => {
    expect(computeMidZoomOverlayEngage(band({ z: 13 }))).toBe(true);
  });
});

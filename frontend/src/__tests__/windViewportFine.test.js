/**
 * WIND VIEWPORT-FINE TIER (2026-07-19 — the circulation-centre data root).
 *
 * THE ROOT: clampViewportBbox's wind branch (v3.15) globalized EVERY wind grid request, and the
 * backend's global wind manifest product is 37x17 = 10-DEGREE cells. A tropical circulation
 * (~300-500 km) is SUB-CELL at that resolution — Invest 91L simply did not exist in the texture
 * the particles advect through, which is why its centre rendered as still air. No shader
 * treatment (palette, size, seeding, persistence) can visualize data that was averaged away.
 *
 * THE FIX: for viewport spans <= 13 deg (both axes), request the 1-degree-snapped viewport bbox.
 * The backend then rejects the global manifest (grid_resolver_selection: span <= 15 -> dynamic)
 * and builds an adaptive fine product (0.25-1.0 deg). Wider views keep the global product, so
 * the synoptic z3-5 look is bit-identical to v3.15.
 *
 * GEOMETRY CONTRACT (backend gates, exact):
 *  - decide_manifest_product serves the global manifest when req span > 15.0 -> the final
 *    (snapped) span must stay <= 15.0 or the fine tier silently degrades to 10-deg coarse.
 *  - viewport_service snaps GFS bboxes to a 1.0-deg lattice (t_sz) for its cache key -> the
 *    client snaps to the same lattice so one pan = one server-side product, not a fan of keys.
 *
 * CACHE CONTRACT: windController keys WIND_CACHE by selectedTileId + hour. A constant fine
 * tileId would cross-serve different regions' grids (Gulf grid returned for a Biscay viewport
 * within the 10-min TTL). The fine tileId therefore encodes the snapped bbox.
 */
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';

const GLOBAL_BOX = { west: -180, south: -80, east: 180, north: 85 };
const vp = (west, south, east, north) => ({ west, south, east, north });

beforeEach(() => { window.__RAW_WIND_VIEWPORT_FINE__ = true; }); // explicit true == the default; kept so these geometry tests are default-independent
afterEach(() => { delete window.__RAW_WIND_VIEWPORT_FINE__; delete window.__RAW_DISABLE_WIND_VIEWPORT_FINE__; });

it('DEFAULT is fine-tier ON — #5 (1bf55931) and #9 (639d5fce) landed; opt-out is = false', () => {
  delete window.__RAW_WIND_VIEWPORT_FINE__;
  const r = clampViewportBbox(vp(-95.2, 20.4, -84.9, 27.6), 'wind', 'GFS', 'wind');
  expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
  // explicit opt-out restores always-global
  window.__RAW_WIND_VIEWPORT_FINE__ = false;
  const r2 = clampViewportBbox(vp(-95.2, 20.4, -84.9, 27.6), 'wind', 'GFS', 'wind');
  expect(r2.clampedBbox).toEqual(GLOBAL_BOX);
  expect(r2.selectedTileId).toBe('global_wind');
});

describe('wind viewport-fine tier (clampViewportBbox)', () => {
  it('small viewports get a snapped viewport bbox, not the globe (the Invest 91L data root)', () => {
    // Gulf of Mexico at ~z6.3 desktop — the invest-watching viewport that motivated the fix.
    const r = clampViewportBbox(vp(-95.2, 20.4, -84.9, 27.6), 'wind', 'GFS', 'wind');
    expect(r.isInside).toBe(true);
    expect(r.clampedBbox).not.toEqual(GLOBAL_BOX);
    expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
    // snapped OUT to the 1-deg lattice: covers the viewport, lands on integers
    expect(r.clampedBbox.west).toBeLessThanOrEqual(-95.2);
    expect(r.clampedBbox.east).toBeGreaterThanOrEqual(-84.9);
    expect(r.clampedBbox.south).toBeLessThanOrEqual(20.4);
    expect(r.clampedBbox.north).toBeGreaterThanOrEqual(27.6);
    for (const v of [r.clampedBbox.west, r.clampedBbox.south, r.clampedBbox.east, r.clampedBbox.north]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('ENUMERATES the span space: every fine bbox stays inside the backend gate AND covers the viewport', () => {
    // Two invariants, enumerated (a single overshoot silently degrades to the 10-deg smear;
    // a single non-covering box puts the border back on screen):
    //  - <= 13-deg viewports (the proven snap-out+pad branch): bbox span <= 15.0 (the marine-era
    //    dynamic gate that branch was built against).
    //  - 13-180-deg viewports (the 2026-07-20 wide band): bbox span <= 190 (proportional 1-4 deg
    //    pad + snap; <=100 stays on the dynamic lane, beyond it the server mid tier clips its
    //    2-deg world product — WIND_MID_RES_MAX_SPAN=200 headroom), and the bbox COVERS the
    //    viewport (the whole point: no visible clamp edge anywhere on the map).
    for (let span = 0.5; span <= 180.01; span += span < 19 ? 0.25 : 7.5) {
      for (const west of [-179.7, -95.2, -0.3, 10.14, 88.9]) {
        for (const south of [-44.6, 0.2, 20.4, 55.1]) {
          const east = west + span, north = Math.min(84.9, south + span * 0.7);
          if (east > 180) continue; // not a real (normalized) viewport

          const r = clampViewportBbox(vp(west, south, east, north), 'wind', 'GFS', 'wind');
          if (r.selectedTileId && r.selectedTileId.startsWith('wind_viewport_fine_')) {
            const sLng = r.clampedBbox.east - r.clampedBbox.west;
            const sLat = r.clampedBbox.north - r.clampedBbox.south;
            expect(sLng).toBeGreaterThan(0);
            expect(sLng).toBeLessThanOrEqual(span <= 13.01 ? 15.0 : 190.0);
            expect(sLat).toBeLessThanOrEqual(span <= 13.01 ? 15.0 : 190.0);
            expect(r.clampedBbox.west).toBeGreaterThanOrEqual(-180);
            expect(r.clampedBbox.east).toBeLessThanOrEqual(180);
            expect(r.clampedBbox.south).toBeGreaterThanOrEqual(-80);
            expect(r.clampedBbox.north).toBeLessThanOrEqual(85);
            if (span > 13.01) {
              expect(r.clampedBbox.west).toBeLessThanOrEqual(west + 0.001);
              expect(r.clampedBbox.east).toBeGreaterThanOrEqual(east - 0.001);
              expect(r.clampedBbox.south).toBeLessThanOrEqual(south + 0.001);
              expect(r.clampedBbox.north).toBeGreaterThanOrEqual(north - 0.001);
            }
          }
        }
      }
    }
  });

  it('only true world-scale viewports keep the v3.15 global product', () => {
    for (const box of [
      vp(-179, -70, 10, 80),      // 189-deg span — beyond the 180-deg wide band
      vp(-179, -70, 179, 80),     // world
    ]) {
      const r = clampViewportBbox(box, 'wind', 'GFS', 'wind');
      expect(r.clampedBbox).toEqual(GLOBAL_BOX);
      expect(r.selectedTileId).toBe('global_wind');
    }
  });

  it('100-180-deg spans still request the viewport (the server mid tier clips its 2-deg world product)', () => {
    const r = clampViewportBbox(vp(-130, -20, -28, 60), 'wind', 'GFS', 'wind'); // 102 x 80
    expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
    const b = r.clampedBbox;
    expect(b.west).toBeLessThanOrEqual(-130);
    expect(b.east).toBeGreaterThanOrEqual(-28);
    expect(b.south).toBeLessThanOrEqual(-20);
    expect(b.north).toBeGreaterThanOrEqual(60);
  });

  describe('WIDE BAND (13-90 deg, 2026-07-20 "the clamp must fit the map"): full padded viewport bbox', () => {
    // THE USER REPORTS (same day, same root): at z5.55 (16.1-deg viewport) the tier stopped
    // asking for fine data entirely — a stale leftover box sat over the 10-deg smear; then the
    // interim centered-15 cap still left uncovered margins ("widen it... it needs to fit the
    // map, not just the viewport"). With the backend's WIND_DYNAMIC_MAX_SPAN_DEG=100 gate, the
    // client now requests the PADDED SNAPPED VIEWPORT for spans up to 90 deg: the box always
    // covers the screen (border off-screen by >= 1 deg pad), and the adaptive ladder prices it
    // at the same ~400 points (16 deg -> 1.0-deg cells, 40 -> 2.0, 90 -> 5.0 — always beats the
    // 10-deg manifest). On a pre-gate backend the request degrades to exactly the old global
    // product — the failure mode of asking is the old behaviour (the tier's founding rule).
    it('the reporting viewport (z5.55 Florida) gets a COVERING fine box', () => {
      const r = clampViewportBbox(vp(-87.83, 22.84, -71.73, 34.8), 'wind', 'GFS', 'wind');
      expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
      const b = r.clampedBbox;
      for (const v of [b.west, b.south, b.east, b.north]) expect(Number.isInteger(v)).toBe(true);
      // covers with >= the 1-deg pad on every side (border provably off-screen)
      expect(b.west).toBeLessThanOrEqual(-88.83);
      expect(b.east).toBeGreaterThanOrEqual(-70.73);
      expect(b.south).toBeLessThanOrEqual(21.84);
      expect(b.north).toBeGreaterThanOrEqual(35.8);
      expect(b.east - b.west).toBeLessThanOrEqual(20);
    });

    it('the 25-deg continental overview (formerly global) gets a covering box at 2-deg pad', () => {
      const r = clampViewportBbox(vp(-100, 15, -75, 32), 'wind', 'GFS', 'wind');
      expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
      const b = r.clampedBbox;
      expect(b.west).toBeLessThanOrEqual(-100);
      expect(b.east).toBeGreaterThanOrEqual(-75);
      expect(b.south).toBeLessThanOrEqual(15);
      expect(b.north).toBeGreaterThanOrEqual(32);
    });

    it('world-edge viewports clamp to world bounds without losing coverage', () => {
      const r = clampViewportBbox(vp(-90, -79, -74, -65), 'wind', 'GFS', 'wind');
      expect(r.selectedTileId).toMatch(/^wind_viewport_fine_/);
      const b = r.clampedBbox;
      expect(b.south).toBe(-80);
      expect(b.north).toBeGreaterThanOrEqual(-64);
    });

    it('kill switch __RAW_DISABLE_WIND_FINE_WIDE__ restores the 13-deg gate exactly', () => {
      window.__RAW_DISABLE_WIND_FINE_WIDE__ = true;
      try {
        const wide = clampViewportBbox(vp(-87.83, 22.84, -71.73, 34.8), 'wind', 'GFS', 'wind');
        expect(wide.selectedTileId).toBe('global_wind');
        // the proven <= 13 branch is untouched by the kill
        const small = clampViewportBbox(vp(-95.2, 20.4, -84.9, 27.6), 'wind', 'GFS', 'wind');
        expect(small.selectedTileId).toMatch(/^wind_viewport_fine_/);
      } finally {
        delete window.__RAW_DISABLE_WIND_FINE_WIDE__;
      }
    });

    it('wide tileIds stay bbox-unique and pan-stable (WIND_CACHE contract)', () => {
      const a = clampViewportBbox(vp(-87.83, 22.84, -71.73, 34.8), 'wind', 'GFS', 'wind');
      const nudge = clampViewportBbox(vp(-87.9, 22.9, -71.8, 34.86), 'wind', 'GFS', 'wind');
      expect(nudge.selectedTileId).toBe(a.selectedTileId); // sub-quantum pan reuses the box
      const shifted = clampViewportBbox(vp(-92.83, 22.84, -76.73, 34.8), 'wind', 'GFS', 'wind');
      expect(shifted.selectedTileId).not.toBe(a.selectedTileId);
    });
  });

  it('kill switch __RAW_DISABLE_WIND_VIEWPORT_FINE__ restores always-global bit-exactly', () => {
    window.__RAW_DISABLE_WIND_VIEWPORT_FINE__ = true;
    const r = clampViewportBbox(vp(-95.2, 20.4, -84.9, 27.6), 'wind', 'GFS', 'wind');
    expect(r.clampedBbox).toEqual(GLOBAL_BOX);
    expect(r.selectedTileId).toBe('global_wind');
  });

  it('antimeridian-crossing viewports fall back to global (no negative-span boxes)', () => {
    const r = clampViewportBbox(vp(176.5, 20.4, -176.2, 27.6), 'wind', 'GFS', 'wind');
    expect(r.clampedBbox).toEqual(GLOBAL_BOX);
    expect(r.selectedTileId).toBe('global_wind');
  });

  it('the fine tileId is bbox-unique (WIND_CACHE cross-region poisoning guard)', () => {
    const gulf = clampViewportBbox(vp(-92.1, 21.3, -85.9, 26.8), 'wind', 'GFS', 'wind');
    const biscay = clampViewportBbox(vp(-8.1, 43.3, -1.9, 48.8), 'wind', 'GFS', 'wind');
    expect(gulf.selectedTileId).toMatch(/^wind_viewport_fine_/);
    expect(biscay.selectedTileId).toMatch(/^wind_viewport_fine_/);
    expect(gulf.selectedTileId).not.toBe(biscay.selectedTileId);
    // and the id is STABLE for sub-degree pans inside the same snapped box (cache reuse)
    const gulfNudge = clampViewportBbox(vp(-92.05, 21.35, -85.85, 26.85), 'wind', 'GFS', 'wind');
    expect(gulfNudge.selectedTileId).toBe(gulf.selectedTileId);
  });

  it('marine branches are untouched by the wind tier (regression pin)', () => {
    const r = clampViewportBbox(vp(-92.1, 21.3, -85.9, 26.8), 'waves', 'GFS', 'marine');
    expect(r.selectedTileId).not.toMatch(/^wind_viewport_fine_/);
  });
});

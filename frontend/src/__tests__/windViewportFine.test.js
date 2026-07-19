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

afterEach(() => { delete window.__RAW_DISABLE_WIND_VIEWPORT_FINE__; });

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

  it('ENUMERATES the span space: every fine bbox stays within the backend dynamic gate (<= 15.0 deg)', () => {
    // The backend serves the 10-deg global manifest when span > 15.0 — a single overshoot
    // silently degrades the tier, so enumerate rather than sample.
    for (let span = 0.5; span <= 13.01; span += 0.25) {
      for (const west of [-179.7, -95.2, -0.3, 10.14, 164.9]) {
        for (const south of [-44.6, 0.2, 20.4, 55.1]) {
          const r = clampViewportBbox(vp(west, south, west + span, south + span * 0.7), 'wind', 'GFS', 'wind');
          if (r.selectedTileId && r.selectedTileId.startsWith('wind_viewport_fine_')) {
            const sLng = r.clampedBbox.east - r.clampedBbox.west;
            const sLat = r.clampedBbox.north - r.clampedBbox.south;
            expect(sLng).toBeGreaterThan(0);
            expect(sLng).toBeLessThanOrEqual(15.0);
            expect(sLat).toBeLessThanOrEqual(15.0);
            expect(r.clampedBbox.west).toBeGreaterThanOrEqual(-180);
            expect(r.clampedBbox.east).toBeLessThanOrEqual(180);
            expect(r.clampedBbox.south).toBeGreaterThanOrEqual(-80);
            expect(r.clampedBbox.north).toBeLessThanOrEqual(85);
          }
        }
      }
    }
  });

  it('wide viewports keep the exact v3.15 global product (synoptic look unchanged)', () => {
    for (const box of [
      vp(-100, 15, -75, 32),      // 25-deg Gulf overview (z ~4.8)
      vp(-40.2, 20.1, -25.9, 36), // 14.3 lng span — above the 13-deg viewport cut
      vp(-179, -70, 179, 80),     // world
    ]) {
      const r = clampViewportBbox(box, 'wind', 'GFS', 'wind');
      expect(r.clampedBbox).toEqual(GLOBAL_BOX);
      expect(r.selectedTileId).toBe('global_wind');
    }
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

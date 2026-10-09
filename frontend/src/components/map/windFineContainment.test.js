/**
 * WIND FINE-TIER CONTAINMENT (2026-10-08 wind zoom audit). Every wind view, GFS / EURO / ICON, rendered
 * the 2-degree global_mid clip at every zoom. Client half of the cause: fetchWindData's containment
 * fallback returns ANY cached grid whose bounds contain the request, skipping only WORLD-span ones
 * (>= 350 deg) when a `wind_viewport_fine_*` tile is wanted. A 190-deg 2-deg clip cached at z2-4
 * (96x74 over -174..16 x -62..84) therefore "contained" every deeper fine request for its whole
 * 10-minute TTL and no fine fetch was ever made (live log at z6.2: "Backend Contained Wind Cache Hit",
 * 7104 vectors). Same family as #269 (series lane).
 *
 * Fix: a containing grid may answer a fine request only if its cells are no coarser than what the
 * fine tier would serve for that span — the backend's choose_adaptive_resolution at 400 points.
 * And a mid-tier answer that is still sharpening (staleReason 'swr_revalidation_pending') lives 15 s
 * in the cache, not 2 min, so the sharpened grid replaces it on the next refresh.
 */
import fs from 'fs';
import path from 'path';
import {
  chooseAdaptiveResolution, windGridCellDeg, fineContainmentAcceptable, windCacheTtlMs,
} from './windFineContainment';

const CLIP_2DEG = { bounds: { west: -174, south: -62, east: 16, north: 84 }, cols: 96, rows: 74 };   // the z2-4 clip
const FINE_025 = { bounds: { west: -96, south: 17, east: -83, north: 31 }, cols: 53, rows: 57 };    // a 0.25-deg viewport product
const Z6_GULF = { west: -95, south: 18, east: -84, north: 30 };                                        // padded snapped z6 request
const Z3_WIDE = { west: -150, south: -10, east: -60, north: 50 };                                     // a 90x60-deg wide-band request

describe('mirror of the backend adaptive resolution (route_helpers.choose_adaptive_resolution)', () => {
  it.each([
    [1, 1, 0.25], [6, 6, 0.5], [11, 12, 1.0], [16, 16, 1.0], [40, 40, 2.0], [50, 40, 2.5], [90, 60, 5.0], [200, 100, 10.0],
  ])('%d x %d deg at 400 points -> %d deg', (lng, lat, want) => {
    expect(chooseAdaptiveResolution(lng, lat)).toBe(want);
  });
});

describe('cell size of a cached wind grid', () => {
  it('is the coarser axis spacing between grid points', () => {
    expect(windGridCellDeg(CLIP_2DEG)).toBeCloseTo(2.0, 6);
    expect(windGridCellDeg(FINE_025)).toBeCloseTo(0.25, 6);
    expect(windGridCellDeg({ bounds: CLIP_2DEG.bounds, cols: 1, rows: 1 })).toBeNaN();
  });
});

describe('a containing cached grid may answer a FINE request only if it is fine enough', () => {
  it('REFUSES the 2-deg clip for a z6 Gulf request (the audit case)', () => {
    expect(fineContainmentAcceptable(CLIP_2DEG, Z6_GULF)).toBe(false);
  });
  it('accepts a 0.25-deg viewport product (small pans inside the padded box stay free)', () => {
    expect(fineContainmentAcceptable(FINE_025, Z6_GULF)).toBe(true);
  });
  it('accepts the 2-deg clip for a wide-band request that would itself be served at 5 deg', () => {
    expect(fineContainmentAcceptable(CLIP_2DEG, Z3_WIDE)).toBe(true);
  });
  it('refuses a grid with no usable cell size', () => {
    expect(fineContainmentAcceptable({ bounds: CLIP_2DEG.bounds, cols: 0, rows: 0 }, Z6_GULF)).toBe(false);
  });
  it('kill switch restores the old rule', () => {
    window.__RAW_DISABLE_WIND_FINE_CONTAIN_GUARD__ = true;
    try { expect(fineContainmentAcceptable(CLIP_2DEG, Z6_GULF)).toBe(true); }
    finally { delete window.__RAW_DISABLE_WIND_FINE_CONTAIN_GUARD__; }
  });
});

describe('cache lifetime', () => {
  it('fresh 10 min, stale 2 min, still-sharpening mid answer 15 s', () => {
    expect(windCacheTtlMs({ data: { stale: false } })).toBe(10 * 60 * 1000);
    expect(windCacheTtlMs({ data: { stale: true, staleReason: 'upstream_cooldown' } })).toBe(2 * 60 * 1000);
    expect(windCacheTtlMs({ data: { stale: true, staleReason: 'swr_revalidation_pending' } })).toBe(15 * 1000);
    expect(windCacheTtlMs(null)).toBe(10 * 60 * 1000);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'windController.js'), 'utf8');
  it('the containment loop applies the guard to fine requests', () => {
    expect(src).toMatch(/if \(wantsFineTile && !fineContainmentAcceptable\(g, clampResult\.clampedBbox\)\) continue;/);
  });
  it('the controller uses the shared TTL rule instead of its own copy', () => {
    expect(src).toMatch(/import \{[^}]*windCacheTtlMs[^}]*\} from '\.\/windFineContainment'/);
    expect(src).not.toMatch(/function windCacheTtlMs\(/);
  });
});

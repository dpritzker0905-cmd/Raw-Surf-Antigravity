/**
 * detectClamp — the "covers-but-too-coarse" clamp (2026-07-04, live "heatmap cleared at z9.34 on
 * the Italy water area, hasn't fixed itself"). A degraded ~1°/cell grid (11×10 over 10°) fully
 * covered the viewport, so the old detectClamp returned {clamp:false} (not global, not too-small)
 * and the render backstop never re-drove — the coarse grid block-means to ~0 at the coast and read
 * near-blank forever. The new kind 'regional_too_coarse' flags it so the backstop sharpens.
 */
import { detectClamp, CLAMP_COARSE_CELL_DEG, CLAMP_MIN_CELLS_ACROSS, isRetainedRegionalZoomedOut } from './useMarineScrubSettle';

// Minimal live-engine + map mocks. mapInstance.getBounds() returns maplibre-style accessors.
const setEngineGrid = (grid) => {
  window.__MARINE_ENGINE__ = grid ? { _waveData: { waveGrid: grid } } : undefined;
};
const mkMap = (zoom, vb) => ({
  getZoom: () => zoom,
  getBounds: () => ({ getWest: () => vb.west, getSouth: () => vb.south, getEast: () => vb.east, getNorth: () => vb.north }),
});

afterEach(() => { delete window.__MARINE_ENGINE__; });

describe('detectClamp — covers-but-too-coarse (regional_too_coarse)', () => {
  // The frozen live state: grid 11×10 over 11..21 lng / 39..48 lat (0.91°/cell); viewport ~1° at z9.34.
  const coarseAdriatic = { bounds: { west: 11, east: 21, south: 39, north: 48 }, cols: 11, rows: 10 };
  const view = { west: 12.81, south: 44.3, east: 13.82, north: 45.04 };

  it('FLAGS the degraded ~1°/cell grid that covers the viewport at z9.34 (the live wedge)', () => {
    setEngineGrid(coarseAdriatic);
    const r = detectClamp(mkMap(9.34, view));
    expect(r.clamp).toBe(true);
    expect(r.kind).toBe('regional_too_coarse');
  });

  it('does NOT flag a FINE tile at deep zoom (few cells across, but SMALL cells)', () => {
    // 13×13 over 2° = 0.15°/cell; z12 viewport ~0.25° shows <2 cells across but the cells are fine.
    setEngineGrid({ bounds: { west: 12.2, east: 14.2, south: 44.4, north: 46.4 }, cols: 13, rows: 13 });
    const r = detectClamp(mkMap(12, { west: 13.0, south: 45.2, east: 13.25, north: 45.4 }));
    expect(r.clamp).toBe(false);
  });

  it('DOES flag the same coarse grid at a wider zoom with <8 cells across (2026-07-05 dwell-sharpen)', () => {
    // z7.4 viewport ~4° over the 0.91°/cell grid → ~4.4 cells across. The old ≥3 floor called this
    // acceptable — but the live Baja report (0.44°/cell, 6.8 across) read as CLAMPED and only a pan
    // pulled the fine grid. <8 across on >0.3°/cell cells now re-drives the sharpen (capped at 2).
    setEngineGrid(coarseAdriatic);
    const r = detectClamp(mkMap(7.4, { west: 12.0, south: 43.0, east: 16.0, north: 46.5 }));
    expect(r).toMatchObject({ clamp: true, kind: 'regional_too_coarse' });
  });

  it('still flags a coarse-GLOBAL grid as coarse_global (unchanged), not too_coarse', () => {
    setEngineGrid({ bounds: { west: -180, east: 180, south: -80, north: 85 }, cols: 37, rows: 17, coverage_scope: 'global_coarse' });
    const r = detectClamp(mkMap(9.34, view));
    expect(r).toMatchObject({ clamp: true, kind: 'coarse_global' });
  });

  it('still flags a too-SMALL non-covering regional grid as regional_too_small (unchanged)', () => {
    setEngineGrid({ bounds: { west: 13.5, east: 14.0, south: 45.1, north: 45.3 }, cols: 8, rows: 6 });
    const r = detectClamp(mkMap(9.34, view));
    expect(r).toMatchObject({ clamp: true, kind: 'regional_too_small' });
  });

  it('no clamp at a zoomed-OUT viewport even with a coarse grid (regionalZoom gate)', () => {
    setEngineGrid(coarseAdriatic);
    const r = detectClamp(mkMap(5, { west: 5, south: 38, east: 25, north: 50 }));
    expect(r.clamp).toBe(false);
  });

  it('exports sane threshold constants', () => {
    expect(CLAMP_COARSE_CELL_DEG).toBe(0.3);
    expect(CLAMP_MIN_CELLS_ACROSS).toBe(8);
  });
});

describe('isRetainedRegionalZoomedOut — the "cleared at ~z6.95" zoom-out reject (2026-07-04)', () => {
  const engWith = (bounds) => ({ _waveData: { waveGrid: { bounds } } });
  const regional = { west: 12, east: 17, south: 42, north: 46.5 }; // span 5° = regional
  const global = { west: -180, east: 180, south: -85, north: 85 }; // span 360° = global

  it('TRUE for a NON-covering regional grid at a zoomed-out viewport (z ≤ 7.0) — the wedge', () => {
    // Viewport extends well past the tile's east edge (coverage ~0.59 < 0.8): the display gate hides
    // it → blank → recovery must fire.
    expect(isRetainedRegionalZoomedOut(engWith(regional), mkMap(6.95, { west: 12.8, south: 42.3, east: 19.9, north: 46.2 }))).toBe(true);
  });

  it('FALSE for a COVERING regional at a zoomed-out viewport (2026-07-05 gate↔recovery alignment)', () => {
    // Fix A shows a regional covering ≥0.8 of the viewport even below z7, and the zoomed-out fetch
    // path commits covering clipped global_mid grids at z5-7 — a HEALTHY display. Flagging it would
    // loop the §2b recovery/backstop refetching a global that never commits.
    expect(isRetainedRegionalZoomedOut(engWith(regional), mkMap(6.95, { west: 13, south: 43, east: 16, north: 46 }))).toBe(false);
  });

  it('FALSE for a GLOBAL grid at a zoomed-out viewport (it displays correctly — do not recover over it)', () => {
    expect(isRetainedRegionalZoomedOut(engWith(global), mkMap(6.95, { west: 12.8, south: 42.3, east: 17.9, north: 46.2 }))).toBe(false);
  });

  it('FALSE for a regional grid when zoomed IN (z > 7.0 — the gate accepts it, no reject)', () => {
    expect(isRetainedRegionalZoomedOut(engWith(regional), mkMap(9.5, { west: 14.0, south: 44.5, east: 15.0, north: 45.3 }))).toBe(false);
  });

  it('FALSE when the engine has no data (that is the plain engineEmpty path)', () => {
    expect(isRetainedRegionalZoomedOut({ _waveData: null }, mkMap(6.5, { west: 12, south: 42, east: 18, north: 46 }))).toBe(false);
    expect(isRetainedRegionalZoomedOut(null, mkMap(6.5, { west: 12, south: 42, east: 18, north: 46 }))).toBe(false);
  });

  it('TRUE via wide viewport span even above z7 (span > 15° is the gate\'s other zoomed-out trigger)', () => {
    expect(isRetainedRegionalZoomedOut(engWith(regional), mkMap(7.5, { west: 0, south: 35, east: 20, north: 50 }))).toBe(true);
  });
});

/**
 * detectClamp — the "covers-but-too-coarse" clamp (2026-07-04, live "heatmap cleared at z9.34 on
 * the Italy water area, hasn't fixed itself"). A degraded ~1°/cell grid (11×10 over 10°) fully
 * covered the viewport, so the old detectClamp returned {clamp:false} (not global, not too-small)
 * and the render backstop never re-drove — the coarse grid block-means to ~0 at the coast and read
 * near-blank forever. The new kind 'regional_too_coarse' flags it so the backstop sharpens.
 */
import { detectClamp, CLAMP_COARSE_CELL_DEG, CLAMP_MIN_CELLS_ACROSS } from './useMarineScrubSettle';

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

  it('does NOT flag the same coarse grid at a WIDER zoom where ≥3 cells span the view', () => {
    // z7.4 viewport ~4° over the 0.91°/cell grid → ~4.4 cells across → acceptable, no re-drive churn.
    setEngineGrid(coarseAdriatic);
    const r = detectClamp(mkMap(7.4, { west: 12.0, south: 43.0, east: 16.0, north: 46.5 }));
    expect(r.clamp).toBe(false);
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
    expect(CLAMP_COARSE_CELL_DEG).toBe(0.5);
    expect(CLAMP_MIN_CELLS_ACROSS).toBe(3);
  });
});

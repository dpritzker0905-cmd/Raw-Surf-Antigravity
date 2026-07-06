/**
 * Engine-parity no-downgrade in useSimulationField (2026-07-06, the z7→z5.3 zoom-out glitch):
 * the marine ENGINE keeps its resident regional texture and rejects a coarser same-layer/hour
 * commit — the field hook must NOT bind that rejected grid into the SimulationLoop (live log
 * proof: "No-downgrade: kept resident regional 10×8" followed by "New field bound: 37×17" —
 * particle field diverging from the heatmap). Holding must dedupe (no rebuild, no rebind churn);
 * a genuine zoom-out must still bind the coarse grid (the engine's self-heal parity).
 */
import { renderHook } from '@testing-library/react';

jest.mock('../engine/SimulationFieldBuilder');
jest.mock('../components/map/marineGridHash');
jest.mock('../engine/SimulationField');

import { useSimulationField } from '../engine/useSimulationField';
import { buildSimulationField } from '../engine/SimulationFieldBuilder';
import { computeGridContentHash } from '../components/map/marineGridHash';
import { getFieldDiagnostics, isFieldPopulated } from '../engine/SimulationField';

// Regional 0.5°/cell tile covering the viewport; same layer + hour as the coarse global.
const regionalData = {
  __renderable: true,
  __provider: 'open-meteo',
  grid: {
    vectors: Array.from({ length: 100 }, () => ({})),
    cols: 10, rows: 8,
    __sourceModel: 'GFS', __componentLayer: 'waves', __renderable: true, __provider: 'open-meteo',
    bounds: { west: -92, south: 10, east: -87, north: 14 },
    hourOffset: 140,
  },
};

// Coarse GLOBAL grid (10°/cell), same layer + hour — the downgrade the engine rejects at z>threshold.
const coarseGlobalData = {
  __renderable: true,
  __provider: 'open-meteo',
  grid: {
    vectors: Array.from({ length: 629 }, () => ({})),
    cols: 37, rows: 17,
    __sourceModel: 'GFS', __componentLayer: 'waves', __renderable: true, __provider: 'open-meteo',
    bounds: { west: -180, south: -80, east: 180, north: 85 },
    hourOffset: 140,
  },
};

function mockMap(zoom, bounds) {
  window.map = {
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => bounds[0], getSouth: () => bounds[1],
      getEast: () => bounds[2], getNorth: () => bounds[3],
    }),
  };
}

describe('useSimulationField — engine-parity no-downgrade', () => {
  beforeEach(() => {
    let hash = 0;
    computeGridContentHash.mockImplementation((grid) => (hash = grid.cols * 1000 + grid.rows));
    getFieldDiagnostics.mockReturnValue({ populated: true });
    isFieldPopulated.mockReturnValue(true);
    buildSimulationField.mockImplementation(({ marineData }) => ({
      revision: 1,
      hourOffset: 140,
      time: Date.now(),
      grid: { vectors: marineData.grid.vectors, cols: marineData.grid.cols, rows: marineData.grid.rows },
      cols: marineData.grid.cols,
      rows: marineData.grid.rows,
      sources: { marine: true },
    }));
    delete window.__MARINE_FIELD_NO_DOWNGRADE__;
  });

  afterEach(() => {
    delete window.map;
    delete window.__RAW_DISABLE_NO_DOWNGRADE__;
  });

  it('holds the bound regional field when a coarser same-layer/hour grid arrives zoomed in', () => {
    mockMap(6.5, [-92, 10, -87, 14]); // inside the regional tile, above the zoomed-out threshold
    const { result, rerender } = renderHook(
      ({ md }) => useSimulationField({ marineData: md, activeMarineLayer: 'waves', timeOffsetHours: 140 }),
      { initialProps: { md: regionalData } }
    );
    const first = result.current.field;
    expect(first.cols).toBe(10);

    rerender({ md: coarseGlobalData });
    expect(result.current.field.cols).toBe(10);   // field HELD — no divergence from the engine
    expect(buildSimulationField).toHaveBeenCalledTimes(1); // no rebuild, no rebind churn
    expect(window.__MARINE_FIELD_NO_DOWNGRADE__.count).toBe(1);
  });

  it('binds the coarse grid once genuinely zoomed out (self-heal parity)', () => {
    mockMap(6.5, [-92, 10, -87, 14]);
    const { result, rerender } = renderHook(
      ({ md }) => useSimulationField({ marineData: md, activeMarineLayer: 'waves', timeOffsetHours: 140 }),
      { initialProps: { md: regionalData } }
    );
    expect(result.current.field.cols).toBe(10);

    mockMap(4.2, [-140, -10, -50, 35]); // wide viewport, below the threshold — coarse is correct now
    rerender({ md: coarseGlobalData });
    expect(result.current.field.cols).toBe(37);   // coarse binds normally
    expect(window.__MARINE_FIELD_NO_DOWNGRADE__).toBeUndefined();
  });

  it('respects the shared kill switch', () => {
    window.__RAW_DISABLE_NO_DOWNGRADE__ = true;
    mockMap(6.5, [-92, 10, -87, 14]);
    const { result, rerender } = renderHook(
      ({ md }) => useSimulationField({ marineData: md, activeMarineLayer: 'waves', timeOffsetHours: 140 }),
      { initialProps: { md: regionalData } }
    );
    rerender({ md: coarseGlobalData });
    expect(result.current.field.cols).toBe(37);   // guard disabled → legacy behavior
  });

  it('binds normally when the map is unavailable (fail open)', () => {
    delete window.map;
    const { result, rerender } = renderHook(
      ({ md }) => useSimulationField({ marineData: md, activeMarineLayer: 'waves', timeOffsetHours: 140 }),
      { initialProps: { md: regionalData } }
    );
    rerender({ md: coarseGlobalData });
    expect(result.current.field.cols).toBe(37);
  });
});

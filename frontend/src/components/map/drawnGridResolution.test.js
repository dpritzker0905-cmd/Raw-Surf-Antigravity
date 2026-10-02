/**
 * The legend's resolution notice describes the grid DRAWN, not the last fetch (2026-10-01).
 *
 * Replayed live: scrubbing to Wed 15Z at far zoom drew a thinned world frame (46 x 20, an 8° lattice) while the
 * diagnostics record still described the regional 0.25° tile (notice SILENT) or, after the exact frame was fetched but
 * not drawn, the 2° product ("~223 km grid (2°)"). Both were the wrong grid. These tests pin that the notice follows
 * the engine's drawn grid, falls back to the diag only when nothing is drawn, and costs nothing when it is not shown.
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import { drawnGridResolutionDeg, useDrawnGridResolution } from './drawnGridResolution';
import { LegendTicks } from './legendTicks';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const engineWith = (grid) => ({ _waveData: { waveGrid: grid } });
const THIN = { bounds: WORLD, cols: 46, rows: 20 };          // the committed far-zoom series frame, as measured
const EXACT = { bounds: WORLD, cols: 181, rows: 82 };        // the exact 2° world frame, as measured
const REGIONAL = { bounds: { west: -82, south: 26, east: -78, north: 30 }, cols: 17, rows: 17 };
const TICKS = [{ pct: 0, label: '0' }, { pct: 100, label: '20+' }];

afterEach(() => {
  delete window.__MARINE_ENGINE__;
  delete window.__MARINE_PROJECTION_DIAG__;
  jest.useRealTimers();
});

describe('drawnGridResolutionDeg', () => {
  it('is unknown (null), never a guess, when nothing readable is drawn', () => {
    expect(drawnGridResolutionDeg()).toBeNull();
    window.__MARINE_ENGINE__ = {};
    expect(drawnGridResolutionDeg()).toBeNull();
    window.__MARINE_ENGINE__ = engineWith(null);
    expect(drawnGridResolutionDeg()).toBeNull();
    window.__MARINE_ENGINE__ = engineWith({ cols: 46, rows: 20 });                   // no bounds
    expect(drawnGridResolutionDeg()).toBeNull();
    window.__MARINE_ENGINE__ = engineWith({ bounds: WORLD, cols: 1, rows: 1 });       // a single cell has no spacing
    expect(drawnGridResolutionDeg()).toBeNull();
    window.__MARINE_ENGINE__ = engineWith({ bounds: { west: 'x' }, cols: 46, rows: 20 });
    expect(drawnGridResolutionDeg()).toBeNull();
  });

  it('never throws on a hostile engine', () => {
    window.__MARINE_ENGINE__ = { get _waveData() { throw new Error('boom'); } };
    expect(() => drawnGridResolutionDeg()).not.toThrow();
    expect(drawnGridResolutionDeg()).toBeNull();
  });

  it('reads the DELIVERED grid: the thinned far-zoom frame is coarse, the exact frame is 2°, the tile is native', () => {
    window.__MARINE_ENGINE__ = engineWith(THIN);
    expect(drawnGridResolutionDeg()).toBeGreaterThan(8);
    expect(drawnGridResolutionDeg()).toBeLessThan(9);
    window.__MARINE_ENGINE__ = engineWith(EXACT);
    expect(drawnGridResolutionDeg()).toBeCloseTo(2, 1);
    window.__MARINE_ENGINE__ = engineWith(REGIONAL);
    expect(drawnGridResolutionDeg()).toBeCloseTo(0.25, 2);
  });
});

describe('useDrawnGridResolution', () => {
  it('follows the engine as frames are committed', () => {
    jest.useFakeTimers();
    window.__MARINE_ENGINE__ = engineWith(EXACT);
    const { result } = renderHook(() => useDrawnGridResolution(true));
    expect(result.current).toBeCloseTo(2, 1);
    act(() => { window.__MARINE_ENGINE__ = engineWith(THIN); jest.advanceTimersByTime(700); });
    expect(result.current).toBeGreaterThan(8);
    act(() => { window.__MARINE_ENGINE__ = engineWith(REGIONAL); jest.advanceTimersByTime(700); });
    expect(result.current).toBeCloseTo(0.25, 2);
  });

  it('starts no timer and reports null when the notice is not shown', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(window, 'setInterval');
    window.__MARINE_ENGINE__ = engineWith(THIN);
    const { result } = renderHook(() => useDrawnGridResolution(false));
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stops its timer on unmount', () => {
    jest.useFakeTimers();
    const clear = jest.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useDrawnGridResolution(true));
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe('LegendTicks notice follows the drawn grid', () => {
  const STALE_REGIONAL_DIAG = { resolution: 0.25, resolutionSource: 'derived_from_served_grid' };
  const EXACT_FETCHED_DIAG = { resolution: 2, resolutionSource: 'derived_from_served_grid' };

  it('THE DEFECT: a thinned 8° frame is drawn while the diag still says 0.25° (silent before), now it speaks', () => {
    window.__MARINE_PROJECTION_DIAG__ = STALE_REGIONAL_DIAG;
    window.__MARINE_ENGINE__ = engineWith(THIN);
    render(<LegendTicks showResolution ticks={TICKS} />);
    expect(screen.getByText(/km grid \(8\.\d°\)/)).toBeInTheDocument();
  });

  it('THE DEFECT, other half: an exact 2° frame is fetched (diag says 2°) while the 8° frame is what is drawn', () => {
    window.__MARINE_PROJECTION_DIAG__ = EXACT_FETCHED_DIAG;
    window.__MARINE_ENGINE__ = engineWith(THIN);
    render(<LegendTicks showResolution ticks={TICKS} />);
    expect(screen.queryByText(/\(2°\)/)).toBeNull();
    expect(screen.getByText(/km grid \(8\.\d°\)/)).toBeInTheDocument();
  });

  it('an exact frame drawn says 2°, and a native tile stays silent (the notice keeps its meaning)', () => {
    window.__MARINE_PROJECTION_DIAG__ = EXACT_FETCHED_DIAG;
    window.__MARINE_ENGINE__ = engineWith(EXACT);
    const first = render(<LegendTicks showResolution ticks={TICKS} />);
    expect(screen.getByText(/~\d+ km grid \(2°\)/)).toBeInTheDocument();
    first.unmount();
    window.__MARINE_ENGINE__ = engineWith(REGIONAL);
    render(<LegendTicks showResolution ticks={TICKS} />);
    expect(screen.queryByText(/km grid/)).toBeNull();
  });

  it('with nothing drawn it falls back to the diag exactly as before', () => {
    window.__MARINE_PROJECTION_DIAG__ = EXACT_FETCHED_DIAG;
    render(<LegendTicks showResolution ticks={TICKS} />);
    expect(screen.getByText(/~\d+ km grid \(2°\)/)).toBeInTheDocument();
  });

  it('is opt-in: a legend that does not show the notice never shows it, drawn grid or not', () => {
    window.__MARINE_PROJECTION_DIAG__ = EXACT_FETCHED_DIAG;
    window.__MARINE_ENGINE__ = engineWith(THIN);
    render(<LegendTicks ticks={TICKS} />);
    expect(screen.queryByText(/km grid/)).toBeNull();
  });
});

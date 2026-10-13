/**
 * The world warm that keeps the zoom-out bridge's base on the SELECTED hour (2026-10-01, audit F-21; marineWorldWarmOnSettle.js).
 *
 * The defect when this is missing: select Wednesday at a regional zoom, zoom out, and the engine draws the page-load world frame
 * (the "now" hour) as Wednesday, because the right hour's world grid was never warmed (an hour chosen through the timeline lanes
 * never reached the fetch paths' redirect branch that warms it). Replayed offline: 3.2 to 3.8 s of the wrong hour, every variant.
 */
import { renderHook } from '@testing-library/react';
import { useMarineWorldWarmOnSettle, _resetWorldWarmForTest, WORLD_WARM_HOLD_MS } from './marineWorldWarmOnSettle';
import { prewarmGlobalMarineGrid } from './marineGlobalPrewarm';

jest.mock('./marineGlobalPrewarm', () => ({ prewarmGlobalMarineGrid: jest.fn() }));

const flag = (k) => { window[k] = true; };

/** A mutable map: regional by default. */
const mkMap = () => ({
  getZoom: () => 9,
  getBounds: () => ({ getWest: () => -80.75, getEast: () => -79.25, getSouth: () => 27.25, getNorth: () => 28.75 }),
});

let map; let refs;
beforeEach(() => {
  jest.useFakeTimers();
  _resetWorldWarmForTest();
  prewarmGlobalMarineGrid.mockReset();
  delete window.isScrubbingTimeline;
  map = mkMap();
  refs = {
    timeOffsetRef: { current: 147 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
    activeMarineLayersRef: { current: ['waves'] },
  };
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__RAW_DISABLE_HOUR_WORLD_WARM__;
  delete window.isScrubbingTimeline;
});

const mount = (marineData = { grid: { id: 'g1' } }, over = {}) =>
  renderHook((p) => useMarineWorldWarmOnSettle(p), { initialProps: { marineData, mapInstance: map, ...refs, ...over } });

describe('useMarineWorldWarmOnSettle: when the world grid for the selected hour is warmed', () => {
  it('after the hour has held still WORLD_WARM_HOLD_MS at a regional viewport: once, grid first, for THAT hour', () => {
    mount();
    jest.advanceTimersByTime(900);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();                             // a click burst or a scrub step never warms a world grid per hour
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS - 900 - 1);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
    const [model, hour, vb, layer, opts] = prewarmGlobalMarineGrid.mock.calls[0];
    expect([model, hour, layer]).toEqual(['GFS', 147, 'waves']);
    expect(vb).toEqual({ west: -80.75, south: 27.25, east: -79.25, north: 28.75 });     // the viewport the prewarm's own gates judge
    expect(opts).toEqual({ gridFirst: true, band: true });                              // before the world series half, which held the lane's single slot; band: the prewarm may serve a 15-40 degree view (F-22 follow-up)
    expect(window.__MARINE_HOUR_WORLD_WARM__).toEqual({ fired: 1 });
  });

  it('hands a band-sized viewport (30 x 20 degrees) to the prewarm untouched: its own gate, not the hook, decides, and it is told the call is a band-capable warm', () => {
    map = { getZoom: () => 5.4, getBounds: () => ({ getWest: () => -95, getEast: () => -65, getSouth: () => 15, getNorth: () => 35 }) };
    mount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1);
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
    const [, , vb, , opts] = prewarmGlobalMarineGrid.mock.calls[0];
    expect(vb).toEqual({ west: -95, south: 15, east: -65, north: 35 });
    expect(opts).toEqual({ gridFirst: true, band: true });
  });

  it('passes the active layer and model through (ICON and a swell layer are not rewritten)', () => {
    refs.activeModelRef.current = 'ICON';
    refs.activeMarineLayerRef.current = 'swell_1';
    mount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1);
    expect(prewarmGlobalMarineGrid.mock.calls[0].slice(0, 2)).toEqual(['ICON', 147]);
    expect(prewarmGlobalMarineGrid.mock.calls[0][3]).toBe('swell_1');
  });

  it('defaults the model to GFS and the layer to waves when the refs are empty', () => {
    refs.activeModelRef.current = '';
    refs.activeMarineLayerRef.current = undefined;
    mount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1);
    expect(prewarmGlobalMarineGrid.mock.calls[0][0]).toBe('GFS');
    expect(prewarmGlobalMarineGrid.mock.calls[0][3]).toBe('waves');
  });

  it('restarts the hold when a NEW grid commits (a click burst warms the hour it ends on, not every step)', () => {
    const { rerender } = mount({ grid: { id: 'g1' } });
    jest.advanceTimersByTime(1000);
    refs.timeOffsetRef.current = 148;
    rerender({ marineData: { grid: { id: 'g2' } }, mapInstance: map, ...refs });
    jest.advanceTimersByTime(600);                                                      // 1600 ms since g1, 600 since g2
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS - 600 + 1);
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
    expect(prewarmGlobalMarineGrid.mock.calls[0][1]).toBe(148);
  });

  it('does NOT restart on a re-render that carries the SAME grid (the settle check re-commits one grid in a fresh wrapper, about once a second)', () => {
    const grid = { id: 'g1' };
    const { rerender } = mount({ grid });
    jest.advanceTimersByTime(1000);
    rerender({ marineData: { grid, other: 1 }, mapInstance: map, ...refs });
    jest.advanceTimersByTime(600);                                                      // 1600 ms since mount: the first timer fired at 1500
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
  });

  it('a moved hour re-arms the wait: nothing at the first hold, a warm for the hour it settled on one hold later (the grid never changed)', () => {
    mount();
    refs.timeOffsetRef.current = 150;                                                   // a +1h click inside one frame: no new grid, no new commit
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS);
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
    expect(prewarmGlobalMarineGrid.mock.calls[0][1]).toBe(150);
  });

  it('an hour that keeps moving never warms (a click burst or autoplay), and the wait stops when the effect does', () => {
    const { unmount } = mount();
    for (let i = 0; i < 6; i++) { refs.timeOffsetRef.current += 1; jest.advanceTimersByTime(WORLD_WARM_HOLD_MS - 100); }
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    unmount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS * 4);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
  });

  it('while the timeline is moving nothing fires and the wait re-arms: it fires one hold after the scrub ends, with no new commit', () => {
    window.isScrubbingTimeline = true;
    mount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS * 3 + 1);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    window.isScrubbingTimeline = false;
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS);
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the model is EURO (its world product takes the slow Copernicus transport)', () => { refs.activeModelRef.current = 'EURO'; }],
    ['no marine layer is active', () => { refs.activeMarineLayersRef.current = null; }],
    ['the kill switch is set', () => flag('__RAW_DISABLE_HOUR_WORLD_WARM__')],
  ])('does not warm when %s', (_label, arrange) => {
    mount();
    arrange();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
  });

  it('arms nothing without a map or without a committed grid, and cancels on unmount', () => {
    mount(null);
    renderHook(() => useMarineWorldWarmOnSettle({ marineData: { grid: { id: 'g' } }, mapInstance: null, ...refs }));
    const { unmount } = mount();
    unmount();
    jest.advanceTimersByTime(WORLD_WARM_HOLD_MS * 2);
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
  });

  it('never throws into the commit that armed it (a map that cannot answer, a prewarm that throws)', () => {
    mount({ grid: { id: 'g1' } }, { mapInstance: { getBounds: () => { throw new Error('torn down'); } } });
    expect(() => jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1)).not.toThrow();
    prewarmGlobalMarineGrid.mockImplementation(() => { throw new Error('boom'); });
    mount({ grid: { id: 'g2' } });
    expect(() => jest.advanceTimersByTime(WORLD_WARM_HOLD_MS + 1)).not.toThrow();
  });
});

/**
 * RENDER-CONTRACT READINESS (2026-07-21): mapbox-gl 5.x `isStyleLoaded()` transiently returns false while
 * a source (re)loads. The old contract reached READY only via `style.load` OR an isStyleLoaded()-gated
 * 500ms poll — so a MISSED style.load (contract mounted after it fired) + a false-isStyleLoaded window
 * left it stuck in STYLE_LOADING forever, silently blocking every raster commit (precip/radar/pressure/OM).
 * Fix: functional-ready = isStyleLoaded() OR areTilesLoaded(), plus the reliable 'idle' event, plus a
 * bounded unconditional backstop so it can NEVER stay stuck.
 */
import { renderHook, act } from '@testing-library/react';
import { isMapFunctionallyReady, useMapRenderContract } from './useMapRenderContract';

describe('isMapFunctionallyReady', () => {
  it('false for no map', () => { expect(isMapFunctionallyReady(null)).toBe(false); });
  it('true when isStyleLoaded()', () => {
    expect(isMapFunctionallyReady({ isStyleLoaded: () => true, areTilesLoaded: () => false })).toBe(true);
  });
  it('true when areTilesLoaded() even if isStyleLoaded() is (transiently) false', () => {
    expect(isMapFunctionallyReady({ isStyleLoaded: () => false, areTilesLoaded: () => true })).toBe(true);
  });
  it('false when both are false', () => {
    expect(isMapFunctionallyReady({ isStyleLoaded: () => false, areTilesLoaded: () => false })).toBe(false);
  });
  it('false (never throws) when a getter throws mid-load', () => {
    expect(isMapFunctionallyReady({ isStyleLoaded: () => { throw new Error('mid-load'); } })).toBe(false);
  });
});

// A minimal mock map: capture event handlers, drive readiness getters, and let tests fire events.
function makeMap({ styleLoaded = false, tilesLoaded = false } = {}) {
  const handlers = {};
  return {
    _styleLoaded: styleLoaded, _tilesLoaded: tilesLoaded,
    isStyleLoaded() { return this._styleLoaded; },
    areTilesLoaded() { return this._tilesLoaded; },
    isMoving() { return false; }, isZooming() { return false; },
    on(evt, cb) { (handlers[evt] = handlers[evt] || []).push(cb); },
    off(evt, cb) { if (handlers[evt]) handlers[evt] = handlers[evt].filter((h) => h !== cb); },
    _fire(evt) { (handlers[evt] || []).slice().forEach((cb) => cb({})); },
    _has(evt) { return (handlers[evt] || []).length; },
  };
}

describe('useMapRenderContract — reaches READY without stranding', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.runOnlyPendingTimers(); jest.useRealTimers();
    delete window.__RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__;
  });

  it('reaches READY via the style.load event', () => {
    const map = makeMap({ styleLoaded: false, tilesLoaded: false });
    const { result } = renderHook(() => useMapRenderContract(map));
    expect(result.current.getState()).toBe('STYLE_LOADING');
    act(() => { map._styleLoaded = true; map._fire('style.load'); });
    expect(result.current.getState()).toBe('READY');
  });

  it('reaches READY via the idle event even if style.load was missed', () => {
    const map = makeMap({ styleLoaded: false, tilesLoaded: false });
    const { result } = renderHook(() => useMapRenderContract(map));
    act(() => { map._fire('idle'); });
    expect(result.current.getState()).toBe('READY');
  });

  it('reaches READY immediately when the map is already functionally ready (areTilesLoaded)', () => {
    const map = makeMap({ styleLoaded: false, tilesLoaded: true });
    const { result } = renderHook(() => useMapRenderContract(map));
    expect(result.current.getState()).toBe('READY');
  });

  it('THE STRAND FIX: the 500ms poll reaches READY on areTilesLoaded while isStyleLoaded stays false', () => {
    const map = makeMap({ styleLoaded: false, tilesLoaded: false });
    const { result } = renderHook(() => useMapRenderContract(map));
    expect(result.current.getState()).toBe('STYLE_LOADING');
    act(() => { map._tilesLoaded = true; jest.advanceTimersByTime(510); });
    expect(result.current.getState()).toBe('READY');
  });

  it('THE BACKSTOP: reaches READY at ~4s even if BOTH signals stay false forever (never permanently stuck)', () => {
    const map = makeMap({ styleLoaded: false, tilesLoaded: false });
    const { result } = renderHook(() => useMapRenderContract(map));
    act(() => { jest.advanceTimersByTime(600); });
    expect(result.current.getState()).toBe('STYLE_LOADING'); // 500ms poll can't help (both false)
    act(() => { jest.advanceTimersByTime(3500); });
    expect(result.current.getState()).toBe('READY');           // backstop fired
  });

  it('the backstop is kill-switchable (legacy: can stay STYLE_LOADING)', () => {
    window.__RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__ = true;
    const map = makeMap({ styleLoaded: false, tilesLoaded: false });
    const { result } = renderHook(() => useMapRenderContract(map));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(result.current.getState()).toBe('STYLE_LOADING');
  });

  it('cleans up the idle listener on unmount', () => {
    const map = makeMap();
    const { unmount } = renderHook(() => useMapRenderContract(map));
    expect(map._has('idle')).toBe(1);
    unmount();
    expect(map._has('idle')).toBe(0);
  });
});

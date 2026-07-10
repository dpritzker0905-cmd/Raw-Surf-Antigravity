/**
 * Audit #11 (2026-07-10): model switches no longer wipe the OM raster caches or rotate the `_cb`
 * URL nonce — the wipe/nonce predate the real cross-model-leakage fix (model-keyed caches +
 * model/run-pathed URLs, 9f231d40), and rotating the nonce changed EVERY om:// tile URL per
 * switch, forcing a full refetch+re-decode on every model compare (the "not snappy" report).
 * __RAW_OM_MODEL_WIPE_LEGACY__ = true restores the legacy wipe exactly.
 */
import { renderHook, act } from '@testing-library/react';
import { useModelTransition } from '../components/map/useModelTransition';
import {
  clearOpenMeteoCache,
  setMapActiveModelLock,
} from '../components/map/mapUtils';
import { validateModelAccess } from '../components/map/LayerAccessResolver';

jest.mock('../components/map/mapUtils', () => ({
  safeSetPaintProperty: jest.fn(),
  setMapActiveModelLock: jest.fn(),
  clearOpenMeteoCache: jest.fn(),
}));

jest.mock('../components/map/LayerAccessResolver', () => ({
  validateModelAccess: jest.fn(),
}));

const mapInstance = {
  isStyleLoaded: () => false,
  getLayer: () => null,
  once: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

function makeProps(activeModel, cacheBustRef) {
  const ref = (v) => ({ current: v });
  return {
    mapInstance,
    activeModel,
    activeLayers: ['pressure'],
    activeMarineLayer: null,
    debouncedTimeOffsetHours: 0,
    closestTimeIdx: 0,
    activeSlots: {},
    cacheBustRef,
    isScrubbingRef: ref(false),
    activeLayersRef: ref(['pressure']),
    activeSlotsRef: ref({}),
    activeMarineLayerRef: ref(null),
    debouncedTimeOffsetHoursRef: ref(0),
    closestTimeIdxRef: ref(0),
    setIsTransitioning: jest.fn(),
    userTier: 'premium',
  };
}

describe('useModelTransition — audit #11 cache retention on model switch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.__RAW_OM_MODEL_WIPE_LEGACY__;
    // CRA jest resetMocks:true — re-arm implementations each test.
    validateModelAccess.mockReturnValue(true);
    clearOpenMeteoCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.__RAW_OM_MODEL_WIPE_LEGACY__;
  });

  it('default: retains caches and keeps the _cb nonce stable across switches', async () => {
    const bust = { current: 111 };
    const { rerender, unmount } = renderHook((p) => useModelTransition(p), {
      initialProps: makeProps('GFS', bust),
    });
    await act(async () => { jest.advanceTimersByTime(2000); });

    rerender(makeProps('EURO', bust));
    await act(async () => { jest.advanceTimersByTime(2000); });

    expect(clearOpenMeteoCache).not.toHaveBeenCalled();
    expect(bust.current).toBe(111); // stable nonce -> om:// URLs identical on switch-back -> caches hit
    expect(setMapActiveModelLock).toHaveBeenCalledWith('EURO'); // the model lock still updates
    unmount();
  });

  it('legacy kill switch restores the wipe + nonce rotation exactly', async () => {
    window.__RAW_OM_MODEL_WIPE_LEGACY__ = true;
    const bust = { current: 111 };
    const { rerender, unmount } = renderHook((p) => useModelTransition(p), {
      initialProps: makeProps('GFS', bust),
    });
    await act(async () => { jest.advanceTimersByTime(2000); });

    rerender(makeProps('ICON', bust));
    await act(async () => { jest.advanceTimersByTime(2000); });

    expect(clearOpenMeteoCache).toHaveBeenCalled();
    expect(bust.current).not.toBe(111); // legacy: nonce rotated
    unmount();
  });
});

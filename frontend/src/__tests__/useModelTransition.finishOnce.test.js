/**
 * Audit #31 (2026-07-11, double-flash on model switch): the two finish arms — once('load') and
 * the 2s style-load safety fallback — never cancelled each other and finishTransition had no
 * run-once guard, so in the boot window BOTH fired ("Transition finished" ×2 = hide/restore ×2).
 * Also: the imperative slot-layer restore now pairs with the legacy blank-out only
 * (window.__RAW_MODEL_SWITCH_BLANK_LEGACY__); the default flow holds the last frame in MapWebGL
 * and re-applying this loop's stale opacity table would stick wrong values (dual-control race).
 */
import { renderHook, act } from '@testing-library/react';
import { useModelTransition } from '../components/map/useModelTransition';
import { clearOpenMeteoCache } from '../components/map/mapUtils';
import { validateModelAccess } from '../components/map/LayerAccessResolver';

jest.mock('../components/map/mapUtils', () => ({
  safeSetPaintProperty: jest.fn(),
  setMapActiveModelLock: jest.fn(),
  clearOpenMeteoCache: jest.fn(),
}));

jest.mock('../components/map/LayerAccessResolver', () => ({
  validateModelAccess: jest.fn(),
}));

function makeMap({ styleLoaded }) {
  const loadHandlers = [];
  return {
    isStyleLoaded: () => styleLoaded,
    getLayer: jest.fn((id) => ({ id })),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
    triggerRepaint: jest.fn(),
    once: jest.fn((ev, cb) => { if (ev === 'load') loadHandlers.push(cb); }),
    on: jest.fn(),
    off: jest.fn(),
    fireLoad: () => { loadHandlers.splice(0).forEach(cb => cb()); },
  };
}

function makeProps(mapInstance, activeModel) {
  const ref = (v) => ({ current: v });
  return {
    mapInstance,
    activeModel,
    activeLayers: ['pressure'],
    activeMarineLayer: null,
    debouncedTimeOffsetHours: 0,
    closestTimeIdx: 0,
    activeSlots: {},
    cacheBustRef: { current: 111 },
    isScrubbingRef: ref(false),
    activeLayersRef: ref(['pressure']),
    activeSlotsRef: ref({ pressure: 0 }),
    activeMarineLayerRef: ref(null),
    debouncedTimeOffsetHoursRef: ref(0),
    closestTimeIdxRef: ref(0),
    setIsTransitioning: jest.fn(),
    userTier: 'premium',
  };
}

describe('useModelTransition — audit #31 single-finish + legacy-gated restore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.__RAW_MODEL_SWITCH_BLANK_LEGACY__;
    validateModelAccess.mockReturnValue(true);
    clearOpenMeteoCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.__RAW_MODEL_SWITCH_BLANK_LEGACY__;
  });

  it('boot window: load event + 2s fallback finish exactly ONCE and disarm each other', async () => {
    const map = makeMap({ styleLoaded: false });
    const props = makeProps(map, 'GFS');
    const { unmount } = renderHook((p) => useModelTransition(p), { initialProps: props });

    // 50ms debounce + promise flush arms both: once('load') and the 2s fallback
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(map.once).toHaveBeenCalledWith('load', expect.any(Function));

    // load fires first → finish #1 (30ms + rAF chain)
    await act(async () => { map.fireLoad(); jest.advanceTimersByTime(200); });
    const finishCalls = props.setIsTransitioning.mock.calls.filter(c => c[0] === false).length;
    expect(finishCalls).toBe(1);
    // the load path disarmed the fallback + removed its own listener
    expect(map.off).toHaveBeenCalledWith('load', expect.any(Function));

    // the 2s fallback window elapses → NO second finish
    await act(async () => { jest.advanceTimersByTime(3000); });
    const finishCallsAfter = props.setIsTransitioning.mock.calls.filter(c => c[0] === false).length;
    expect(finishCallsAfter).toBe(1);
    unmount();
  });

  it('fallback path: fires once and a late load event cannot double-finish', async () => {
    const map = makeMap({ styleLoaded: false });
    const props = makeProps(map, 'EURO');
    const { unmount } = renderHook((p) => useModelTransition(p), { initialProps: props });

    await act(async () => { jest.advanceTimersByTime(100); });
    // fallback at 2s → finish #1
    await act(async () => { jest.advanceTimersByTime(2300); });
    expect(props.setIsTransitioning.mock.calls.filter(c => c[0] === false).length).toBe(1);

    // a straggler load event afterwards is a no-op (run-once guard)
    await act(async () => { map.fireLoad(); jest.advanceTimersByTime(200); });
    expect(props.setIsTransitioning.mock.calls.filter(c => c[0] === false).length).toBe(1);
    unmount();
  });

  it('default: finish does NOT imperatively repaint the raster slots (MapWebGL holds the frame)', async () => {
    const map = makeMap({ styleLoaded: true });
    const props = makeProps(map, 'GFS');
    const { unmount } = renderHook((p) => useModelTransition(p), { initialProps: props });

    // stage 1: 50ms debounce + microtask arm finishTransition's 30ms timer; stage 2: 30ms + rAF
    await act(async () => { jest.advanceTimersByTime(100); });
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(props.setIsTransitioning).toHaveBeenCalledWith(false);
    const slotCalls = map.setLayoutProperty.mock.calls.filter(c => /-slot-\d+-layer$/.test(c[0]));
    expect(slotCalls).toHaveLength(0);
    unmount();
  });

  it('legacy kill switch restores the imperative slot restore exactly', async () => {
    window.__RAW_MODEL_SWITCH_BLANK_LEGACY__ = true;
    const map = makeMap({ styleLoaded: true });
    const props = makeProps(map, 'GFS');
    const { unmount } = renderHook((p) => useModelTransition(p), { initialProps: props });

    await act(async () => { jest.advanceTimersByTime(100); });
    await act(async () => { jest.advanceTimersByTime(200); });
    const slotCalls = map.setLayoutProperty.mock.calls.filter(c => /pressure-slot-\d+-layer$/.test(c[0]));
    expect(slotCalls.length).toBe(3); // all three ring slots re-asserted visible
    unmount();
  });
});

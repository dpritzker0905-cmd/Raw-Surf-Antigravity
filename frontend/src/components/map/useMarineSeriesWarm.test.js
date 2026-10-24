import { renderHook, act } from '@testing-library/react';
import { useMarineSeriesWarm } from './useMarineSeriesWarm';
import { ensureMarineSeries, prewarmMarineSeries } from './marineGridSeries';
import { prewarmSiblingMarineSeries } from './marineController';
jest.mock('./marineController', () => ({ prewarmSiblingMarineSeries: jest.fn() }));
jest.mock('./marineGridSeries', () => ({ ensureMarineSeries: jest.fn(), prewarmMarineSeries: jest.fn(),
  marineSeriesViewportIdentity: (model, layer, bounds) => `${model}_${layer}_${bounds.east-bounds.west > 60 ? 'global' : bounds.west}_p0_anchor` }));

describe('mounted viewport warm lifecycle', () => {
  let flag, props, handlers, bounds;
  beforeEach(() => {
    flag = process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS;
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'true'; jest.useFakeTimers(); jest.clearAllMocks();
    handlers = {}; bounds = { west: -81, east: -80, south: 20, north: 21 };
    props = { activeModel: 'GFS', activeMarineLayer: 'waves', activeModelRef: { current: 'GFS' },
      activeMarineLayerRef: { current: 'waves' }, timeOffsetRef: { current: 0 },
      mapInstance: { on: (event, callback) => { handlers[event] = callback; }, off: event => delete handlers[event],
        getBounds: () => ({ getWest: () => bounds.west, getEast: () => bounds.east, getSouth: () => bounds.south, getNorth: () => bounds.north }) } };
  });
  afterEach(() => {
    jest.useRealTimers();
    if (flag === undefined) delete process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS;
    else process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = flag;
  });
  const signal = () => prewarmMarineSeries.mock.calls.at(-1)[3];
  it('initial model warm and settled warm share intent, and movement cancels it', () => {
    const h = renderHook(() => useMarineSeriesWarm(props)); const initial = signal();
    act(() => jest.advanceTimersByTime(600)); expect(signal()).toBe(initial);
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    expect(initial.aborted).toBe(true); expect(signal().aborted).toBe(false);
    expect(ensureMarineSeries.mock.calls.at(-1)[4]).toBe(signal()); h.unmount();
  });
  it('same viewport and scrub hour changes preserve the warm, cleanup cancels it', () => {
    const h = renderHook(() => useMarineSeriesWarm(props)); const initial = signal();
    act(() => { props.timeOffsetRef.current = 144; handlers.moveend(); jest.advanceTimersByTime(400); window.dispatchEvent(new Event('timeline_scrub_start')); });
    expect(signal()).toBe(initial); expect(initial.aborted).toBe(false);
    h.unmount(); expect(initial.aborted).toBe(true); expect(handlers.moveend).toBeUndefined();
  });
  it('regional movement retains an earlier global warm until effect cleanup', () => {
    bounds = { west: -180, east: 180, south: -80, north: 85 };
    const h = renderHook(() => useMarineSeriesWarm(props)); const initial = signal();
    act(() => { bounds = { west: -81, east: -80, south: 20, north: 21 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    expect(initial.aborted).toBe(false); expect(signal()).not.toBe(initial);
    h.unmount(); expect(initial.aborted).toBe(true);
  });
  it.each(['model', 'layer'])('%s switch cancels former work and installs a fresh intent', kind => {
    const h = renderHook(p => useMarineSeriesWarm(p), { initialProps: props }); const initial = signal();
    if (kind === 'model') { props.activeModelRef.current = 'ICON'; props = { ...props, activeModel: 'ICON' }; }
    else { props.activeMarineLayerRef.current = 'swell_1'; props = { ...props, activeMarineLayer: 'swell_1' }; }
    h.rerender(props); act(() => jest.advanceTimersByTime(600));
    expect(initial.aborted).toBe(true); expect(signal().aborted).toBe(false); h.unmount();
  });
  it("a pan's series waits until the map has been still 400 ms; a new move restarts the wait; the kill switch asks at once", () => {
    const h = renderHook(() => useMarineSeriesWarm(props));
    act(() => jest.advanceTimersByTime(600)); ensureMarineSeries.mockClear();
    act(() => { handlers.moveend(); jest.advanceTimersByTime(300); handlers.movestart(); handlers.moveend(); jest.advanceTimersByTime(399); });
    expect(ensureMarineSeries).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
    window.__RAW_DISABLE_SERIES_PAN_DEBOUNCE__ = true;
    act(() => handlers.moveend());
    expect(ensureMarineSeries).toHaveBeenCalledTimes(2);
    delete window.__RAW_DISABLE_SERIES_PAN_DEBOUNCE__;
    h.unmount(); expect(handlers.movestart).toBeUndefined();
  });
  it('the sibling-layer warm follows the visible series (not only a /grid commit); its kill switch stops it', async () => {
    const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
    let h = renderHook(() => useMarineSeriesWarm(props));
    act(() => jest.advanceTimersByTime(600)); await flush();
    expect(prewarmSiblingMarineSeries).toHaveBeenCalledTimes(1);
    expect(prewarmSiblingMarineSeries.mock.calls[0].slice(0, 4)).toEqual(['GFS', 0, bounds, 'waves']);
    expect(prewarmSiblingMarineSeries.mock.calls[0][4]).toBe(ensureMarineSeries.mock.calls.at(-1)[4]);   // the visible warm's signal
    h.unmount(); jest.clearAllMocks();
    window.__RAW_DISABLE_SIBLING_WARM_ON_SERIES__ = true;
    h = renderHook(() => useMarineSeriesWarm(props));
    act(() => jest.advanceTimersByTime(600)); await flush();
    expect(ensureMarineSeries).toHaveBeenCalled();
    expect(prewarmSiblingMarineSeries).not.toHaveBeenCalled();
    delete window.__RAW_DISABLE_SIBLING_WARM_ON_SERIES__; h.unmount();
  });
  it('flag-off with the supersede killed retains the legacy viewport lifetime and independent model warm', () => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'false';
    window.__RAW_DISABLE_SERIES_PAN_SUPERSEDE__ = true;
    const h = renderHook(() => useMarineSeriesWarm(props)); const modelSignal = signal();
    act(() => jest.advanceTimersByTime(600)); const settled = signal();
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    const same = signal() === settled, settledAborted = settled.aborted, distinct = modelSignal !== settled;   // booleans: an AbortSignal diff exhausts the heap
    h.unmount(); delete window.__RAW_DISABLE_SERIES_PAN_SUPERSEDE__;
    expect([same, settledAborted, distinct, modelSignal.aborted, settled.aborted]).toEqual([true, false, true, true, true]);
  });
  it('flag-off by DEFAULT: the MODEL-SWITCH warm shares the intent, so a pan to another box supersedes it too; its kill keeps it apart', () => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'false';
    const h = renderHook(() => useMarineSeriesWarm(props));
    const modelSignal = prewarmMarineSeries.mock.calls[0][3];                 // the model-switch warm on mount
    act(() => jest.advanceTimersByTime(600));
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    const shared = [modelSignal.aborted];
    h.unmount();
    jest.clearAllMocks();
    window.__RAW_DISABLE_MODEL_WARM_SUPERSEDE__ = true;
    bounds = { west: -81, east: -80, south: 20, north: 21 };
    const h2 = renderHook(() => useMarineSeriesWarm(props));
    const apart = prewarmMarineSeries.mock.calls[0][3];
    act(() => jest.advanceTimersByTime(600));
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    const kept = [apart.aborted];
    h2.unmount(); delete window.__RAW_DISABLE_MODEL_WARM_SUPERSEDE__;
    expect([shared[0], kept[0]]).toEqual([true, false]);   // booleans: an AbortSignal diff exhausts the heap
  });
  it('flag-off by DEFAULT: a pan to another snapped box supersedes the old box work (2026-10-23; production leaves the flag unset)', () => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'false';
    const h = renderHook(() => useMarineSeriesWarm(props));
    act(() => jest.advanceTimersByTime(600)); const settled = ensureMarineSeries.mock.calls.at(-1)[4];
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); jest.advanceTimersByTime(400); });
    const next = ensureMarineSeries.mock.calls.at(-1)[4];
    const r = [settled.aborted, next === settled, next.aborted];
    h.unmount();
    expect(r).toEqual([true, false, false]);
  });
});

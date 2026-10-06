import { renderHook, act } from '@testing-library/react';
import { useMarineSeriesWarm } from './useMarineSeriesWarm';
import { ensureMarineSeries, prewarmMarineSeries } from './marineGridSeries';
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
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); });
    expect(initial.aborted).toBe(true); expect(signal().aborted).toBe(false);
    expect(ensureMarineSeries.mock.calls.at(-1)[4]).toBe(signal()); h.unmount();
  });
  it('same viewport and scrub hour changes preserve the warm, cleanup cancels it', () => {
    const h = renderHook(() => useMarineSeriesWarm(props)); const initial = signal();
    act(() => { props.timeOffsetRef.current = 144; handlers.moveend(); window.dispatchEvent(new Event('timeline_scrub_start')); });
    expect(signal()).toBe(initial); expect(initial.aborted).toBe(false);
    h.unmount(); expect(initial.aborted).toBe(true); expect(handlers.moveend).toBeUndefined();
  });
  it('regional movement retains an earlier global warm until effect cleanup', () => {
    bounds = { west: -180, east: 180, south: -80, north: 85 };
    const h = renderHook(() => useMarineSeriesWarm(props)); const initial = signal();
    act(() => { bounds = { west: -81, east: -80, south: 20, north: 21 }; handlers.moveend(); });
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
  it('flag-off retains the legacy viewport lifetime and independent model warm', () => {
    process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS = 'false';
    const h = renderHook(() => useMarineSeriesWarm(props)); const modelSignal = signal();
    act(() => jest.advanceTimersByTime(600)); const settled = signal();
    act(() => { bounds = { ...bounds, west: -71, east: -70 }; handlers.moveend(); });
    expect(signal()).toBe(settled); expect(settled.aborted).toBe(false); expect(modelSignal).not.toBe(settled);
    h.unmount(); expect(modelSignal.aborted).toBe(true); expect(settled.aborted).toBe(true);
  });
});

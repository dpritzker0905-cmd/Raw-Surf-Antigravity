import { act, renderHook } from '@testing-library/react';
import { useLayerTruthDiff } from './useLayerTruthDiff';

function fixture() {
  const handlers = {};
  let layers = [];
  const map = {
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    off: jest.fn((event, handler) => { if (handlers[event] === handler) delete handlers[event]; }),
    getStyle: jest.fn(() => ({ layers })),
    getLayoutProperty: jest.fn(() => 'visible'),
  };
  const props = { mapInstance: map, activeLayers: ['waves'], activeRenderType: 'marine',
    windData: null, marineData: { grid: { vectors: [{ speed: 1 }] } } };
  const hook = renderHook(value => useLayerTruthDiff(value), { initialProps: props });
  const emit = event => act(() => handlers[event]?.());
  const advance = ms => act(() => jest.advanceTimersByTime(ms));
  const overlap = () => { layers = [
    { id: 'waves-a', type: 'raster', source: 'waves-source' },
    { id: 'wind-a', type: 'raster', source: 'wind-source' },
  ]; };
  return { map, props, hook, emit, advance, overlap };
}

describe('truth snapshots share a render/idle budget and own delayed work', () => {
  beforeEach(() => { jest.useFakeTimers(); delete window.isScrubbingTimeline; });
  afterEach(() => { delete window.isScrubbingTimeline; jest.useRealTimers(); });

  test('animated custom-layer render/idle pairs stay within four checks per second', () => {
    const f = fixture();
    for (let frame = 0; frame < 60; frame++) {
      f.advance(16); f.emit('render'); f.emit('idle');
    }
    f.advance(40);
    expect(f.map.getStyle.mock.calls.length).toBeLessThanOrEqual(5); // mount + four checks
    expect(f.map.getStyle.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  test('render-only animation retains its bounded inspections', () => {
    const f = fixture();
    for (let frame = 0; frame < 60; frame++) { f.advance(16); f.emit('render'); }
    expect(f.map.getStyle.mock.calls.length).toBeLessThanOrEqual(5);
    expect(f.map.getStyle.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  test('a final idle checks the latest style within250ms even without another frame', () => {
    const f = fixture();
    f.advance(100); f.overlap(); f.emit('idle');
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
    f.advance(150);
    expect(f.map.getStyle).toHaveBeenCalledTimes(2);
    expect(f.hook.result.current.issues.some(value => value.type === 'RASTER_OVERLAP')).toBe(true);
  });

  test('idle honors active timeline scrubbing', () => {
    const f = fixture(); window.isScrubbingTimeline = true;
    for (let i = 0; i < 20; i++) { f.advance(20); f.emit('idle'); }
    f.advance(300);
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
  });

  test('render honors active timeline scrubbing', () => {
    const f = fixture(); window.isScrubbingTimeline = true;
    f.advance(500); f.emit('render');
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
  });

  test('a queued idle also honors scrubbing that starts before its deadline', () => {
    const f = fixture(); f.advance(100); f.emit('idle');
    window.isScrubbingTimeline = true; f.advance(150);
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
    delete window.isScrubbingTimeline; f.emit('idle');
    expect(f.map.getStyle).toHaveBeenCalledTimes(2);
  });

  test('an idle storm owns only one trailing callback', () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.emit('idle');
    expect(jest.getTimerCount()).toBe(1);
    f.advance(250);
    expect(f.map.getStyle).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('pending moveend work never reads a disposed map', () => {
    const f = fixture(); f.emit('moveend'); f.hook.unmount(); f.advance(500);
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
  });

  test('a model/data update cancels the previous moveend closure', () => {
    const f = fixture(); f.emit('moveend');
    f.hook.rerender({ ...f.props, activeLayers: ['wind'], windData: { vectors: [{ speed: 1 }] } });
    f.map.getStyle.mockClear(); f.advance(500);
    expect(f.map.getStyle).not.toHaveBeenCalled();
    expect(f.hook.result.current.issues).toEqual([]);
  });

  test('moveend bursts coalesce to the latest settled check', () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.emit('moveend');
    f.overlap(); f.advance(100);
    expect(f.map.getStyle).toHaveBeenCalledTimes(2);
    expect(f.hook.result.current.issues.some(value => value.type === 'RASTER_OVERLAP')).toBe(true);
  });

  test('unmount cancels the final idle inspection', () => {
    const f = fixture(); f.advance(100); f.emit('idle');
    f.map.getStyle.mockClear(); f.hook.unmount(); f.advance(500);
    expect(f.map.getStyle).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('effect replacement cancels old idle work and inspects the new state immediately', () => {
    const f = fixture(); f.advance(100); f.emit('idle'); f.map.getStyle.mockClear();
    f.hook.rerender({ ...f.props, activeLayers: ['wind'], windData: { vectors: [{ speed: 1 }] } });
    expect(f.map.getStyle).toHaveBeenCalledTimes(1);
    f.advance(500); expect(f.map.getStyle).toHaveBeenCalledTimes(1);
  });

  test('an uninitialized style does not disable later inspections', () => {
    const f = fixture();
    f.map.getStyle.mockImplementationOnce(() => { throw new Error('style unavailable'); });
    f.advance(250); expect(() => f.emit('idle')).not.toThrow();
    f.overlap(); f.advance(250); f.emit('idle');
    expect(f.hook.result.current.issues.some(value => value.type === 'RASTER_OVERLAP')).toBe(true);
  });
});

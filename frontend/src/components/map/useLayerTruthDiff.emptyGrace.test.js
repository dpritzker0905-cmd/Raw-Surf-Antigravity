import { renderHook, act } from '@testing-library/react';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import { MARINE_EMPTY_GRACE_MS } from './marineEmptyGrace';

// Wiring for W-32: the hook must ask marineEmptyGrace, and must look again when the grace ends even if
// the map never renders again (an idle map fires no 'render' event).
function fakeMap() {
  const handlers = {};
  return {
    on: jest.fn((ev, fn) => { handlers[ev] = fn; }),
    off: jest.fn((ev) => { delete handlers[ev]; }),
    getStyle: jest.fn(() => ({ layers: [] })),
    getLayoutProperty: jest.fn(() => 'visible'),
    handlers,
  };
}
const emptyTypes = (issues) => issues.filter((i) => i.type === 'MARINE_EMPTY_RENDER');

describe('useLayerTruthDiff + marineEmptyGrace (W-32)', () => {
  const T0 = 1_800_000_000_000;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    delete window.__MARINE_TRANSITIONING__;
    delete window.__MARINE_FETCH_PENDING__;
    delete window.__MARINE_FETCH_DEBOUNCING__;
    delete window.__RAW_DISABLE_MARINE_EMPTY_GRACE__;
  });
  afterEach(() => { jest.useRealTimers(); });

  function mountEmptyWaves(map) {
    // Past the hook's own 3 s bootstrap suppression, so only the grace decides.
    const r = renderHook((props) => useLayerTruthDiff(props), {
      initialProps: { mapInstance: map, activeLayers: ['waves'], activeRenderType: 'marine', windData: null, marineData: { grid: { vectors: [] } } },
    });
    return r;
  }

  test('an empty spell shorter than the grace is not reported, and a commit inside it clears the clock', () => {
    const map = fakeMap();
    const r = mountEmptyWaves(map);
    act(() => { jest.advanceTimersByTime(MARINE_EMPTY_GRACE_MS - 1000); });
    act(() => { map.handlers.idle(); });
    expect(emptyTypes(r.result.current.issues)).toHaveLength(0);
    // The grid commits: vectors present, the spell ends, nothing is reported even after the grace.
    r.rerender({ mapInstance: map, activeLayers: ['waves'], activeRenderType: 'marine', windData: null, marineData: { grid: { vectors: [{ u: 1, v: 0, speed: 1 }] } } });
    act(() => { jest.advanceTimersByTime(MARINE_EMPTY_GRACE_MS * 2); });
    expect(emptyTypes(r.result.current.issues)).toHaveLength(0);
  });

  test('a real empty render is reported by the scheduled re-check, with no further map events', () => {
    const map = fakeMap();
    jest.setSystemTime(T0 + 5000);                       // mount 5 s "after" the bootstrap window
    const r = mountEmptyWaves(map);
    expect(emptyTypes(r.result.current.issues)).toHaveLength(0);
    act(() => { jest.advanceTimersByTime(MARINE_EMPTY_GRACE_MS + 100); });   // only the hook's own timer runs
    expect(emptyTypes(r.result.current.issues)).toHaveLength(1);
  });

  test('the kill switch restores the immediate report', () => {
    window.__RAW_DISABLE_MARINE_EMPTY_GRACE__ = true;
    const map = fakeMap();
    const r = mountEmptyWaves(map);
    expect(emptyTypes(r.result.current.issues)).toHaveLength(1);
  });

  test('while a fetch is pending nothing is reported and no re-check is armed', () => {
    window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves' };
    const map = fakeMap();
    const r = mountEmptyWaves(map);
    act(() => { jest.advanceTimersByTime(MARINE_EMPTY_GRACE_MS * 3); });
    expect(emptyTypes(r.result.current.issues)).toHaveLength(0);
  });
});

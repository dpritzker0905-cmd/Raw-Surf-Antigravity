import { renderHook, act } from '@testing-library/react';
import { usePressureIsobars } from './usePressureIsobars';
import { emitOwnShown, emitOwnWant, _resetOwnRasterFramesForTest } from './ownRasterFrames';
import { requestIsobars, _resetIsobarStoreForTest } from './isobarStore';

// A recording stand-in for the MapLibre map: sources, layers, visibility, events.
function fakeMap() {
  const sources = {}; const layers = {}; const handlers = {};
  return {
    sources, layers,
    getStyle: () => ({ layers: [{ id: 'place', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } }] }),
    addSource: (id, s) => { sources[id] = { data: s.data, setData(d) { this.data = d; } }; },
    getSource: (id) => sources[id],
    removeSource: (id) => { delete sources[id]; },
    addLayer: (l) => { layers[l.id] = { ...l, visibility: (l.layout && l.layout.visibility) || 'visible' }; },
    getLayer: (id) => layers[id],
    removeLayer: (id) => { delete layers[id]; },
    setLayoutProperty: (id, k, v) => { if (k === 'visibility') layers[id].visibility = v; },
    setPaintProperty: () => {},
    on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
    off: (e, fn) => { handlers[e] = (handlers[e] || []).filter((f) => f !== fn); },
    fire: (e, arg) => (handlers[e] || []).forEach((fn) => fn(arg)),
  };
}
const vis = (m, b) => ['line', 'label'].map((k) => m.layers[`own-raster-pressure-isobar-${k}-${b}`].visibility).concat(m.layers[`own-raster-pressure-centre-${b}`].visibility);
const field = (shift) => {
  const cols = 72; const rows = 37; const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = -90 + r * 5; const lon = -180 + c * 5;
    values[r * cols + c] = 1013 - 30 * Math.exp(-(((lat - 40) ** 2 + (lon - shift) ** 2) / 300));
  }
  return { cols, rows, bounds: { west: -180, south: -90, east: 175, north: 90 }, values };
};

beforeEach(() => { _resetOwnRasterFramesForTest(); _resetIsobarStoreForTest(); delete window.__RAW_DISABLE_RASTER_ISOBARS__; });

test('the lines never outlive their frame: hidden-buffer prepare, same-call swap at the cut, nothing when not ready', async () => {
  const m = fakeMap();
  await act(async () => { await requestIsobars('p1', field(-30)); await requestIsobars('p2', field(-20)); });
  renderHook(() => usePressureIsobars({ mapInstance: m, engaged: true, theme: 'dark' }));
  expect(vis(m, 'a')).toEqual(['none', 'none', 'none']);
  act(() => emitOwnWant('pressure', 'p1'));                         // a step picked p1: loaded into a hidden buffer
  const holder = ['a', 'b'].find((b) => m.sources[`own-raster-pressure-isobars-${b}`].data.features.length);
  expect(holder).toBeDefined();
  act(() => emitOwnShown('pressure', 'p1'));                        // the cut came before the buffer loaded: no lines at all
  expect([...vis(m, 'a'), ...vis(m, 'b')].every((v) => v === 'none')).toBe(true);
  act(() => m.fire('sourcedata', { sourceId: `own-raster-pressure-isobars-${holder}`, isSourceLoaded: true }));
  expect(vis(m, holder)).toEqual(['visible', 'visible', 'visible']);    // p1's lines, now that they are p1's
  const other = holder === 'a' ? 'b' : 'a';
  act(() => emitOwnWant('pressure', 'p2'));                         // the next frame prepares in the OTHER buffer
  act(() => m.fire('sourcedata', { sourceId: `own-raster-pressure-isobars-${other}`, isSourceLoaded: true }));
  expect(vis(m, holder)).toEqual(['visible', 'visible', 'visible']);    // still p1 on screen
  act(() => emitOwnShown('pressure', 'p2'));                        // the cut: the swap happens in this very call
  expect(vis(m, other)).toEqual(['visible', 'visible', 'visible']);
  expect(vis(m, holder)).toEqual(['none', 'none', 'none']);
  act(() => emitOwnWant('pressure', null));                         // no frame for the asked hour: no lines
  expect([...vis(m, 'a'), ...vis(m, 'b')].every((v) => v === 'none')).toBe(true);
});

test('the kill switch draws nothing; labels use a font the basemap already serves', () => {
  window.__RAW_DISABLE_RASTER_ISOBARS__ = true;
  const m = fakeMap();
  renderHook(() => usePressureIsobars({ mapInstance: m, engaged: true, theme: 'light' }));
  expect(Object.keys(m.layers)).toEqual([]);
  delete window.__RAW_DISABLE_RASTER_ISOBARS__;
  const m2 = fakeMap();
  renderHook(() => usePressureIsobars({ mapInstance: m2, engaged: true, theme: 'light' }));
  expect(m2.layers['own-raster-pressure-isobar-label-a'].layout['text-font']).toEqual(['Noto Sans Regular']);
  expect(m2.layers['own-raster-pressure-centre-a'].layout['text-field']).toEqual(['get', 'label']);
});

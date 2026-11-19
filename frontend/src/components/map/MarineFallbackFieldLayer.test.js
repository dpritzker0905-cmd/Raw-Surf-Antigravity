/**
 * MarineFallbackFieldLayer: our own wave-height field as a plain MapLibre canvas source while the marine engine is failed.
 * What is pinned: it draws through MapLibre's own raster path; a redraw re-reads the same canvas; and with nothing of ours
 * to draw (no grid, a rating grid, the kill, a failed draw, an inactive layer) NOTHING is on the map and the reason is
 * published for the legend. No state adds any other source.
 */
import {
  syncFallbackField, removeFallbackField, publishFallbackField, FALLBACK_SOURCE_ID, FALLBACK_LAYER_ID, FALLBACK_FIELD_EVENT,
} from './MarineFallbackFieldLayer';
import { fallbackOpacityExpression } from './marineFallbackField';

jest.mock('./GPUMarineLayer', () => ({ MarineParticleCanvas: () => null }));

function fakeMap({ failAddSource = false } = {}) {
  const sources = new Map(); const layers = new Map(); const calls = [];
  const map = {
    calls, sources, layers,
    addSource: jest.fn((id, spec) => { calls.push(['addSource', id]); if (failAddSource) throw new Error('boom');
      sources.set(id, { spec, setCoordinates: jest.fn((c) => { calls.push(['setCoordinates']); spec.coordinates = c; }), play: jest.fn(() => calls.push(['play'])), pause: jest.fn(() => calls.push(['pause'])) }); }),
    getSource: (id) => sources.get(id),
    removeSource: jest.fn((id) => { calls.push(['removeSource', id]); sources.delete(id); }),
    addLayer: jest.fn((layer, before) => { calls.push(['addLayer', layer.id, before]); layers.set(layer.id, { layer, before }); }),
    getLayer: (id) => layers.get(id),
    removeLayer: jest.fn((id) => { calls.push(['removeLayer', id]); layers.delete(id); }),
    triggerRepaint: jest.fn(),
  };
  return map;
}
const grid = (extra = {}) => {
  const cols = 5; const rows = 5; const vectors = [];
  for (let k = 0; k < cols * rows; k++) vectors.push({ u: 0, v: 0, speed: 1 + (k % 5) * 0.5, isOcean: true });
  return { bounds: { west: 0, south: 0, east: 8, north: 8 }, cols, rows, vectors, valid_time: '2026-11-18T12:00:00Z', activeMarineLayer: 'waves', __sourceModel: 'GFS', ...extra };
};

let putImageData;
beforeEach(() => {
  putImageData = jest.fn();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ putImageData }));
  global.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  delete window.__RAW_OWN_MARINE_FALLBACK__; delete window.__RAW_DISABLE_OWN_MARINE_FALLBACK__;
});

describe('syncFallbackField', () => {
  test('draws our grid through a plain canvas source and raster layer, under the anchor when it exists', () => {
    const map = fakeMap(); map.layers.set('marine-anchor', {}); const held = { canvas: null };
    const state = syncFallbackField(map, held, { active: true, grid: grid(), theme: 'dark', beforeId: 'marine-anchor' });
    const src = map.sources.get(FALLBACK_SOURCE_ID).spec;
    expect(src.type).toBe('canvas'); expect(src.animate).toBe(false); expect(src.canvas).toBe(held.canvas);
    expect(src.coordinates).toEqual([[-1, 9], [9, 9], [9, -1], [-1, -1]]);            // the outer cell edges
    const { layer, before } = map.layers.get(FALLBACK_LAYER_ID);
    expect(layer.type).toBe('raster'); expect(layer.source).toBe(FALLBACK_SOURCE_ID); expect(before).toBe('marine-anchor');
    expect(layer.paint).toEqual({ 'raster-opacity': fallbackOpacityExpression(), 'raster-resampling': 'linear', 'raster-fade-duration': 0 });
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ drawn: true, reason: null, theme: 'dark', layer: 'waves', model: 'GFS', validTime: '2026-11-18T12:00:00Z' });
    expect(window.__RAW_OWN_MARINE_FALLBACK__).toMatchObject({ drawn: true, draws: 1, width: held.canvas.width, height: held.canvas.height });
  });
  test('an anchor that is not on the map is not passed (MapLibre throws on an unknown beforeId)', () => {
    const map = fakeMap();
    syncFallbackField(map, { canvas: null }, { active: true, grid: grid(), theme: 'light', beforeId: 'not-there' });
    expect(map.layers.get(FALLBACK_LAYER_ID).before).toBeUndefined();
  });
  test('the next hour on the same grid repaints the SAME canvas and tells the source to read it again', () => {
    const map = fakeMap(); const held = { canvas: null };
    syncFallbackField(map, held, { active: true, grid: grid(), theme: 'dark' });
    const canvas = held.canvas; map.calls.length = 0;
    const state = syncFallbackField(map, held, { active: true, grid: grid({ valid_time: '2026-11-18T15:00:00Z' }), theme: 'dark' });
    expect(held.canvas).toBe(canvas);
    expect(map.calls.map((c) => c[0])).toEqual(['setCoordinates', 'play', 'pause']);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(putImageData).toHaveBeenCalledTimes(2);
    expect(state.validTime).toBe('2026-11-18T15:00:00Z');
    expect(window.__RAW_OWN_MARINE_FALLBACK__.draws).toBe(2);
  });
  test('a grid of another size gets a new canvas and a new source', () => {
    const map = fakeMap(); const held = { canvas: null };
    syncFallbackField(map, held, { active: true, grid: grid(), theme: 'dark' });
    const first = held.canvas;
    const big = grid(); big.cols = 5; big.rows = 5; big.bounds = { west: 0, south: 0, east: 8, north: 60 };
    syncFallbackField(map, held, { active: true, grid: big, theme: 'dark' });
    expect(held.canvas).not.toBe(first);
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.sources.size).toBe(1); expect(map.layers.size).toBe(1);
  });
  test.each([
    ['no grid', { active: true, grid: null }, 'no_grid'],
    ['a malformed grid', { active: true, grid: { bounds: { west: 0, south: 0, east: 1, north: 1 }, cols: 2, rows: 2, vectors: [] } }, 'no_grid'],
    ['a surf-rating grid', { active: true, grid: grid({ ratingMode: true }) }, 'rating_grid'],
    ['an all-land grid', { active: true, grid: (() => { const g = grid(); g.vectors.forEach((p) => { p.isOcean = false; }); return g; })() }, 'no_ocean'],
    ['an inactive layer', { active: false, grid: grid() }, 'inactive'],
  ])('%s: NOTHING on the map, the reason published, and what was drawn before is removed', (name, args, reason) => {
    const map = fakeMap(); const held = { canvas: null };
    syncFallbackField(map, held, { active: true, grid: grid(), theme: 'beach' });
    const events = []; const on = (e) => events.push(e.detail); window.addEventListener(FALLBACK_FIELD_EVENT, on);
    const state = syncFallbackField(map, held, { theme: 'beach', ...args });
    window.removeEventListener(FALLBACK_FIELD_EVENT, on);
    expect(state).toMatchObject({ drawn: false, reason });
    expect(map.sources.size).toBe(0); expect(map.layers.size).toBe(0);
    expect(events).toEqual([{ drawn: false, reason }]);
    expect(window.__RAW_OWN_MARINE_FALLBACK__).toMatchObject({ drawn: false, reason });
  });
  test('THE KILL: nothing drawn, reason "killed", read on every sync', () => {
    const map = fakeMap(); const held = { canvas: null };
    syncFallbackField(map, held, { active: true, grid: grid(), theme: 'light' });
    window.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true;
    expect(syncFallbackField(map, held, { active: true, grid: grid(), theme: 'light' })).toMatchObject({ drawn: false, reason: 'killed' });
    expect(map.sources.size).toBe(0); expect(map.layers.size).toBe(0);
    delete window.__RAW_DISABLE_OWN_MARINE_FALLBACK__;
    expect(syncFallbackField(map, held, { active: true, grid: grid(), theme: 'light' })).toMatchObject({ drawn: true });
  });
  test('a draw that throws leaves nothing on the map and says "draw_failed"; it never reaches for another source', () => {
    const map = fakeMap({ failAddSource: true });
    const state = syncFallbackField(map, { canvas: null }, { active: true, grid: grid(), theme: 'dark' });
    expect(state).toMatchObject({ drawn: false, reason: 'draw_failed' });
    expect(map.sources.size).toBe(0); expect(map.layers.size).toBe(0);
    expect(map.addSource.mock.calls.every((c) => c[0] === FALLBACK_SOURCE_ID)).toBe(true);
  });
  test('ONLY its own source id is ever added, in every state, and that source is a canvas of ours (no URL, no tiles)', () => {
    const map = fakeMap(); const held = { canvas: null };
    for (const args of [{ active: true, grid: grid() }, { active: true, grid: null }, { active: false, grid: grid() }, { active: true, grid: grid({ ratingMode: true }) }, { active: true, grid: grid() }]) {
      syncFallbackField(map, held, { theme: 'dark', ...args });
    }
    for (const [id, spec] of map.addSource.mock.calls) {
      expect(id).toBe(FALLBACK_SOURCE_ID);
      expect(spec.type).toBe('canvas'); expect(spec.url).toBeUndefined(); expect(spec.tiles).toBeUndefined();
    }
  });
  test('a react-map-gl ref (getMap) is unwrapped; no map at all is a no-op', () => {
    const map = fakeMap();
    expect(syncFallbackField({ getMap: () => map }, { canvas: null }, { active: true, grid: grid(), theme: 'dark' })).toMatchObject({ drawn: true });
    expect(syncFallbackField(null, { canvas: null }, { active: true, grid: grid(), theme: 'dark' })).toBeNull();
  });
});

describe('removeFallbackField and publishFallbackField', () => {
  test('remove takes the layer first, then the source, and tolerates a map that is already gone', () => {
    const map = fakeMap();
    syncFallbackField(map, { canvas: null }, { active: true, grid: grid(), theme: 'dark' });
    map.calls.length = 0; removeFallbackField(map);
    expect(map.calls).toEqual([['removeLayer', FALLBACK_LAYER_ID], ['removeSource', FALLBACK_SOURCE_ID]]);
    expect(() => removeFallbackField(null)).not.toThrow();
    expect(() => removeFallbackField({ getLayer: () => { throw new Error('style gone'); } })).not.toThrow();
  });
  test('draws are counted only when something was drawn', () => {
    publishFallbackField({ drawn: true, reason: null }); publishFallbackField({ drawn: false, reason: 'no_grid' }); publishFallbackField({ drawn: true, reason: null });
    expect(window.__RAW_OWN_MARINE_FALLBACK__).toMatchObject({ drawn: true, draws: 2 });
  });
});

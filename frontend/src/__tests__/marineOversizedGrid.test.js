/**
 * marineOversizedGrid.test.js
 *
 * Forensic finding (2026-06-20): a transient backend response served ICON swell_1
 * as a native global 0.25deg grid — 1441x661 = 952,501 vectors with only ~798
 * ocean cells — instead of the normal coarse product (19x9). Feeding ~1M vectors
 * into encodeMarineTexture + land-mask build + particle-texture reset freezes the
 * tab ("struggling to load"). mapNormalizedGridToWebGL now rejects any grid above a
 * sane cell cap as a transient non-renderable so the SWR retry re-fetches the
 * coarse product. Real products (dynamic ~9x9, regional ~33x33, coarse ~37x17) are
 * far under the cap and pass through unchanged.
 */
import { mapNormalizedGridToWebGL } from '../components/map/backendWeatherServiceClientHelpers';

const makeGridJson = (cols, rows, speed = 1.5) => {
  const vectors = [];
  for (let i = 0; i < cols * rows; i++) {
    vectors.push({ lat: 28 + (i % rows) * 0.01, lng: -80 + Math.floor(i / rows) * 0.01, u: 0.1, v: 0.1, speed, period: 8 });
  }
  return {
    provider: 'open-meteo',
    product_id: 'test_product',
    grid: { cols, rows, vectors, bounds: { west: -180, south: -80, east: 180, north: 85 } },
  };
};

describe('mapNormalizedGridToWebGL — oversized-grid guard', () => {
  it('rejects a ~1M-vector global native grid as a transient non-renderable', () => {
    const json = makeGridJson(1441, 661); // 952,501 vectors
    const result = mapNormalizedGridToWebGL(json, null, 0, 'swell_1', 'ICON');
    expect(result.grid.renderable).toBe(false);
    expect(result.grid.vectors.length).toBe(0);
    expect(result.grid.cols).toBe(0);
    expect(result.grid.oversizedRejected).toBe(true);
    expect(result.grid.emptyGridWarning).toMatch(/Oversized grid/);
    // __sourceModel/__componentLayer preserved so downstream parity checks stay honest
    expect(result.grid.__sourceModel).toBe('ICON');
    expect(result.grid.__componentLayer).toBe('swell_1');
  });

  it('passes a normal coarse grid (37x17) through unchanged and renderable', () => {
    const json = makeGridJson(37, 17, 2.0);
    const result = mapNormalizedGridToWebGL(json, null, 0, 'waves', 'GFS');
    expect(result.grid.renderable).toBe(true);
    expect(result.grid.vectors.length).toBe(37 * 17);
    expect(result.grid.oversizedRejected).toBeUndefined();
  });

  it('passes a regional grid (33x33) through unchanged', () => {
    const json = makeGridJson(33, 33, 1.2);
    const result = mapNormalizedGridToWebGL(json, null, 0, 'swell_1', 'ICON');
    expect(result.grid.renderable).toBe(true);
    expect(result.grid.vectors.length).toBe(33 * 33);
  });
});

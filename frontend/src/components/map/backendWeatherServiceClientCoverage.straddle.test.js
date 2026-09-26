/**
 * A15-03 (audit 15.0, measured live 2026-09-25 at Sebastian Inlet): one zoom-out step must not
 * trade the 0.25° regional field for the 2° global_mid when most of the view is still inside the tile.
 *
 * z8 viewport -82.15..-78.75 × 26.76..28.95 crosses florida_east_coast's -79 edge. The legacy pad +
 * 1° snap asked /grid for -84..-77 × 25..30: 46% overlap with the served lattice (-83..-79 × 26..31),
 * under the backend's 70% rule, so the GPU drew 42 vectors (2°) where 289 (0.25°) existed.
 */
import {
  clampViewportBbox, straddleTileClip, setCachedManifest,
  STRADDLE_MIN_INSIDE_FRACTION, STRADDLE_MAX_SPAN_DEG,
} from './backendWeatherServiceClientCoverage';

const FL_MANIFEST = {
  products: [
    { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
    { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  ],
};
// The lattice the live product actually served (served_bbox, measured): the backend's overlap rule
// is applied against THIS, not the manifest coverage, so the test measures against it.
const SERVED_LATTICE = { west: -83, south: 26, east: -79, north: 31 };
const SEBASTIAN_Z8 = { west: -82.15, south: 26.76, east: -78.75, north: 28.95 };

const overlapFraction = (r, p) => {
  const oLng = Math.max(0, Math.min(r.east, p.east) - Math.max(r.west, p.west));
  const oLat = Math.max(0, Math.min(r.north, p.north) - Math.max(r.south, p.south));
  return (oLng * oLat) / ((r.east - r.west) * (r.north - r.south));
};
const onQuarterGrid = v => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-9;

beforeEach(() => setCachedManifest(FL_MANIFEST));
afterEach(() => {
  delete window.__RAW_DISABLE_STRADDLE_TILE_CLIP__;
  delete window.__RAW_DISABLE_MANIFEST_TILE_CLIP__;
});

test('the measured Sebastian z8 view asks for a box the backend will serve at 0.25°', () => {
  const res = clampViewportBbox(SEBASTIAN_Z8, 'waves', 'GFS');
  expect(res.isInside).toBe(true);
  expect(res.straddle.tileId).toBe('florida_east_coast');
  const b = res.clampedBbox;
  expect(b.east).toBe(-78.75);                           // crossing side: the viewport edge, no pad
  expect(b.west).toBeLessThan(SEBASTIAN_Z8.west);        // inside sides keep their pan pad
  expect(b.south).toBeLessThan(SEBASTIAN_Z8.south);
  expect(b.north).toBeGreaterThan(SEBASTIAN_Z8.north);
  [b.west, b.south, b.east, b.north].forEach(v => expect(onQuarterGrid(v)).toBe(true));
  // The property that decides the serve: ≥ the backend's 70% against the lattice it has.
  expect(overlapFraction(b, SERVED_LATTICE)).toBeGreaterThanOrEqual(STRADDLE_MIN_INSIDE_FRACTION);
});

test('the legacy request it replaces fell under the backend threshold (the defect, pinned)', () => {
  window.__RAW_DISABLE_STRADDLE_TILE_CLIP__ = true;
  const legacy = clampViewportBbox(SEBASTIAN_Z8, 'waves', 'GFS').clampedBbox;
  expect(legacy).toEqual({ west: -84, south: 25, east: -77, north: 30 });   // the request measured live
  expect(overlapFraction(legacy, SERVED_LATTICE)).toBeLessThan(STRADDLE_MIN_INSIDE_FRACTION);
});

test('a wide view fully inside the tile no longer snaps across its edge', () => {
  const inside = { west: -83.4, south: 26.8, east: -79.6, north: 28.9 };   // 3.8° wide, inside -85..-79
  const b = clampViewportBbox(inside, 'waves', 'GFS').clampedBbox;
  expect(b.east).toBeLessThanOrEqual(-79);
  expect(b.west).toBeGreaterThanOrEqual(-85);
});

test.each([
  ['mostly outside the tile (the pinned legacy straddler)', { west: -79.2, south: 26.5, east: -77.9, north: 27.8 }],
  ['fully inside and ≤2.5° (the manifest-tile clip owns it)', { west: -80.65, south: 26.35, east: -79.25, north: 27.75 }],
  ['wider than the rule span', { west: -84.9, south: 24.1, east: -84.9 + STRADDLE_MAX_SPAN_DEG + 0.5, north: 30.9 }],
  ['across the antimeridian', { west: 179, south: -18, east: -179, north: -16 }],
])('no straddle clip when %s', (_label, raw) => {
  const spanLng = raw.east < raw.west ? raw.east + 360 - raw.west : raw.east - raw.west;
  expect(straddleTileClip('GFS', 'marine', 'waves', raw, raw, spanLng, raw.north - raw.south)).toBeNull();
});

test('only real regional tiles qualify, never a global product', () => {
  setCachedManifest({ products: [FL_MANIFEST.products[1]] });
  const span = [SEBASTIAN_Z8.east - SEBASTIAN_Z8.west, SEBASTIAN_Z8.north - SEBASTIAN_Z8.south];
  expect(straddleTileClip('GFS', 'marine', 'waves', SEBASTIAN_Z8, SEBASTIAN_Z8, ...span)).toBeNull();
});

test('kill switch __RAW_DISABLE_STRADDLE_TILE_CLIP__ restores the legacy request', () => {
  window.__RAW_DISABLE_STRADDLE_TILE_CLIP__ = true;
  const res = clampViewportBbox(SEBASTIAN_Z8, 'waves', 'GFS');
  expect(res.straddle).toBeUndefined();
  expect(res.clampedBbox.east).toBeGreaterThan(-78.75);
});

test('the manifest-tile clip kill switch is still honoured for its own ≤2.5° case', () => {
  window.__RAW_DISABLE_MANIFEST_TILE_CLIP__ = true;
  const jupiter = { west: -80.65, south: 26.35, east: -79.25, north: 27.75 };
  expect(clampViewportBbox(jupiter, 'waves', 'GFS').clampedBbox.east).toBeGreaterThan(-79);
});

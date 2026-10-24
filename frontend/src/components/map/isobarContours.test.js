import { contourLevels, isobars, isobarProducts, pressureCentres, smoothField, stitch } from './isobarContours';

// A 0.5-degree global field like the frames: row 0 = 90S, column 0 = 180W, no wrap column.
const COLS = 720; const ROWS = 361;
const BOUNDS = { west: -180, south: -90, east: 179.5, north: 90 };
function field(fn) {
  const values = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) values[r * COLS + c] = fn(-90 + r * 0.5, -180 + c * 0.5);
  return { cols: COLS, rows: ROWS, bounds: BOUNDS, values };
}
// Great-circle-ish distance in degrees (good enough near a centre).
const dist = (lat, lon, la0, lo0) => {
  let dl = lon - lo0; while (dl > 180) dl -= 360; while (dl < -180) dl += 360;
  return Math.hypot(lat - la0, dl * Math.cos((lat * Math.PI) / 180));
};
const low = (la0, lo0, depth = 30, r = 12) => (lat, lon) => 1013 - depth * Math.exp(-((dist(lat, lon, la0, lo0) / r) ** 2));

test('levels are the multiples of the step inside the field, majors every 20', () => {
  expect(contourLevels(new Float32Array([983.2, 1001, 1020.4]), 4)).toEqual([984, 988, 992, 996, 1000, 1004, 1008, 1012, 1016, 1020]);
  expect(contourLevels(new Float32Array([-9999, -9999]), 4)).toEqual([]);
  const lines = isobars(field(low(40, -30)), { step: 4, major: 20 });
  const lvls = [...new Set(lines.features.map((f) => f.properties.hpa))];
  expect(lvls).toEqual(expect.arrayContaining([984, 992, 1000, 1008]));
  expect(lines.features.every((f) => f.properties.major === (f.properties.hpa % 20 === 0))).toBe(true);
});

test('a low draws closed rings at the radius the field puts each level', () => {
  const lines = isobars(field(low(40, -30)), { step: 4 });
  const ring = lines.features.filter((f) => f.properties.hpa === 996);
  expect(ring).toHaveLength(1);
  const cs = ring[0].geometry.coordinates;
  expect(cs[0]).toEqual(cs[cs.length - 1]);                                   // closed
  // 1013 - 30 exp(-(d/12)^2) = 996  ->  d = 12 sqrt(ln(30/17))
  const want = 12 * Math.sqrt(Math.log(30 / 17));
  for (const [lon, lat] of cs) expect(Math.abs(dist(lat, lon, 40, -30) - want)).toBeLessThan(0.35);
});

test('a low on the antimeridian closes into ONE continuous ring', () => {
  const lines = isobars(field(low(-20, 180)), { step: 4 });
  const ring = lines.features.filter((f) => f.properties.hpa === 1000);
  expect(ring).toHaveLength(1);
  const cs = ring[0].geometry.coordinates;
  expect(cs[0]).toEqual(cs[cs.length - 1]);
  for (let i = 1; i < cs.length; i++) expect(Math.abs(cs[i][0] - cs[i - 1][0])).toBeLessThan(1.1);   // no 360-degree jumps
});

test('stitch joins segments that share an edge, in order', () => {
  const p = (k, x, y) => ({ k, x, y });
  const lines = stitch([[p('a', 0, 0), p('b', 1, 0)], [p('c', 2, 0), p('b', 1, 0)], [p('c', 2, 0), p('d', 3, 0)]]);
  expect(lines).toHaveLength(1);
  expect(lines[0].map((q) => q.k)).toEqual(['a', 'b', 'c', 'd']);
});

test('H and L where they are, labelled with their pressure; none on a flat field', () => {
  const f = field((lat, lon) => low(45, -40, 28)(lat, lon) + 26 * Math.exp(-((dist(lat, lon, 30, -150) / 15) ** 2)));
  const c = pressureCentres(smoothField(f)).features;
  const L = c.filter((x) => x.properties.kind === 'L'); const H = c.filter((x) => x.properties.kind === 'H');
  expect(L).toHaveLength(1); expect(H).toHaveLength(1);
  expect(dist(L[0].geometry.coordinates[1], L[0].geometry.coordinates[0], 45, -40)).toBeLessThan(2.1);
  expect(dist(H[0].geometry.coordinates[1], H[0].geometry.coordinates[0], 30, -150)).toBeLessThan(2.1);
  expect(L[0].properties.label).toMatch(/^L\n98\d$/);
  expect(pressureCentres(field(() => 1013)).features).toEqual([]);
});

test('missing cells stay missing and draw nothing; products bundle lines and centres', () => {
  const f = field(low(0, 0));
  for (let i = 0; i < COLS * 40; i++) f.values[i] = -9999;                // the southern rows: no data
  const s = smoothField(f);
  expect(s.values[5]).toBe(-9999);
  const p = isobarProducts(f);
  expect(p.lines.features.length).toBeGreaterThan(0);
  expect(p.lines.features.every((ft) => ft.geometry.coordinates.every(([, lat]) => lat >= -90 + 39 * 0.5))).toBe(true);
  expect(p.centres.features.some((ft) => ft.properties.kind === 'L')).toBe(true);
});

import { coastInBox } from './marineCoastTest';

const sq = (w, s, e, n) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const LAND = { type: 'FeatureCollection', features: [sq(0, 0, 10, 10), { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[20, 20], [21, 20], [21, 21], [20, 20]]]] } }] };

test('a vertex in the box, or an edge crossing it, is a coastline', () => {
  expect(coastInBox(LAND, [9, 9, 11, 11])).toBe(true);          // a corner vertex
  expect(coastInBox(LAND, [4, -1, 6, 1])).toBe(true);           // the south edge crosses, no vertex inside
  expect(coastInBox(LAND, [20.4, 19.9, 20.6, 20.1])).toBe(true);   // a MultiPolygon's edge
});
test('open water and a box wholly inland have no coastline; no land data is unknown (null)', () => {
  expect(coastInBox(LAND, [12, 12, 18, 18])).toBe(false);
  expect(coastInBox(LAND, [3, 3, 6, 6])).toBe(false);
  expect(coastInBox(null, [0, 0, 1, 1])).toBeNull();
  expect(coastInBox({ features: [] }, [0, 0, 1, 1])).toBe(false);
});

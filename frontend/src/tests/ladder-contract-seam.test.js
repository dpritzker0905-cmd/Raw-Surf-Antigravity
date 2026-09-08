const { assessGlobalSeam } = require('../../scripts/ladder-contract');

function grid(west, east, deadWest = false) {
  return { bounds: { west, east }, vectors: [
    { lng: west, lat: 0, speed: deadWest ? 0 : 2, is_valid: !deadWest },
    { lng: east, lat: 0, speed: 2, is_valid: true },
  ] };
}

test('an island edge cannot be diagnosed as an antimeridian seam', () => {
  const verdict = assessGlobalSeam(grid(-29.292, -24.6272, true));
  expect(verdict.ok).toBe(false);
  expect(verdict.message).toContain('unmeasured');
});
test('real global endpoints pass when populated and fail when one is dead', () => {
  expect(assessGlobalSeam(grid(-180, 180)).ok).toBe(true);
  expect(assessGlobalSeam(grid(-180, 180, true)).ok).toBe(false);
});
test('global bounds alone cannot disguise a regional vector payload', () => {
  const g = grid(-29, -24);
  g.bounds = { west: -180, east: 180 };
  expect(assessGlobalSeam(g).ok).toBe(false);
});

import { selectPrecomputedLaddered } from './spotRatingsCdn';

const box = [-82, 24, -79, 28];
const policy = { surf_height_statistic: 'H1/10', cap_seam: 'legacy', factor_applied: 1.27 };
const frame = (model, convention) => ({ model, valid_time: '2026-09-16T00:00:00Z',
  spots: [{ spot_id: model, latitude: 26, longitude: -80, score: 55 }],
  ...(convention ? { height_convention: convention } : {}) });

test.each(['2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z'])('CDN preserves selected frame policy at %s', time => {
  const obj = { frames: [frame('ICON', { ...policy, cap_seam: 'monotone' }), frame('GFS', policy)] };
  const before = JSON.stringify(obj);
  const hit = selectPrecomputedLaddered(obj, box, 'GFS', time);
  expect(hit.height_convention).toEqual(policy);
  expect(hit.spots[0].score).toBe(55);
  expect(JSON.stringify(obj)).toBe(before);
});

test('old frames cannot inherit another frame or an outer object policy', () => {
  const obj = { height_convention: policy, frames: [frame('GFS'), frame('ICON', policy)] };
  const hit = selectPrecomputedLaddered(obj, box, 'GFS', '2026-09-16T00:00:00Z');
  expect(hit.height_convention).toBeNull();
});

test.each(['invalid', []])('malformed optional policy stays unknown: %s', metadata => {
  const f = frame('GFS');
  f.height_convention = metadata;
  const hit = selectPrecomputedLaddered({ frames: [f] }, box, 'GFS', f.valid_time);
  expect(hit.height_convention).toBeNull();
  expect(hit.spots[0].score).toBe(55);
});

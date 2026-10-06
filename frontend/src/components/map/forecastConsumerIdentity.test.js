import { ratingsShallowEqual } from './useSpotRatings';
const rating = { score: 72, level: 'good', surfHeightM: 1, periodS: 12, tide: { height_m: 0.5 },
  source: 'endpoint', confidence: 0.9, why: ['wind'], directionalConflict: false,
  modelAgreement: { GFS: 72 }, geometryReadiness: 'ready' };
beforeEach(() => { process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true'; });
afterEach(() => { delete process.env.REACT_APP_FORECAST_STATE_IDENTITY; });
test.each([
  ['surfHeightM', 2], ['periodS', 14], ['tide', { height_m: 1 }], ['source', 'grid'],
  ['confidence', 0.2], ['why', ['swell']], ['directionalConflict', true],
  ['modelAgreement', { GFS: 65 }], ['geometryReadiness', 'missing'],
])('same rounded rating must update when %s changes', (key, value) => {
  expect(ratingsShallowEqual({ a: rating }, { a: { ...rating, [key]: value } })).toBe(false);
});
test('structurally identical readings preserve the memo reference despite key order', () => {
  expect(ratingsShallowEqual({ a: rating }, { a: { ...rating, tide: { height_m: 0.5 }, why: ['wind'] } })).toBe(true);
});
test('default-off control preserves existing score/level memo', () => {
  delete process.env.REACT_APP_FORECAST_STATE_IDENTITY;
  expect(ratingsShallowEqual({ a: rating }, { a: { ...rating, surfHeightM: 2 } })).toBe(true);
});

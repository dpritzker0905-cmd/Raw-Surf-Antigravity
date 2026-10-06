import { conditionFields, historicalSession, applyConditionFields } from './composerConditions';
test('numeric zero replaces every prior measurement and degrees govern direction', () => {
  const data = { wave_height_ft: 0, wave_period_sec: 0, wind_speed_mph: 0, tide_height_ft: 0, wave_direction_degrees: 0, wave_direction: 'S' };
  const result = conditionFields(data);
  expect(result.available).toBe(true);
  expect(result.fields).toMatchObject({ waveHeightFt: '0', wavePeriodSec: '0', windSpeedMph: '0', tideHeightFt: '0', waveDirectionDegrees: 0, waveDirection: 'N' });
});
test.each([{}, { wave_height_ft: null, wind_speed_mph: NaN }, { wave_height_ft: Infinity, wave_period_sec: '12' }])('missing/invalid measurements are cleared and cannot report success: %j', data => {
  const result = conditionFields(data); expect(result.available).toBe(false);
  expect(result.fields.waveHeightFt).toBe(''); expect(result.fields.wavePeriodSec).toBe(''); expect(result.fields.windSpeedMph).toBe('');
});
test('all fields replace state on every result', () => {
  const setters = Object.fromEntries(Object.keys(conditionFields().fields).map(k => [k, jest.fn()]));
  expect(applyConditionFields({}, setters)).toBe(false);
  for (const fn of Object.values(setters)) expect(fn).toHaveBeenCalledTimes(1);
});
test('past local dates cannot borrow the current forecast', () => {
  const now = new Date(2026, 9, 4, 12);
  expect(historicalSession('2026-10-03', now)).toBe(true);
  expect(historicalSession('2026-10-04', now)).toBe(false);
});

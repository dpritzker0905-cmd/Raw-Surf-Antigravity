/**
 * ICON card blank, "Offshore swell height --" (the lead's offline regression re-run at 4bd90d0d9, present since 2026-06-08):
 * replayed offline from that run's own rows (rs-regress-1027 runs-2026-10-27/infobox_icon_lattice.json: ICON Waves at 30,-70,
 * z4.6, started 2026-10-28T10:07:15Z, hour 0 at 10Z). Each hour's /point answer is ONE instant at the stored 3-hourly frame its
 * ask snapped to. selectExactPointHour read that instant as the END of a range, so whenever the stored frame was EARLIER than
 * the selected hour (h3 13Z -> 12Z, h6 16Z -> 15Z) the hour fell "past" it: status no_coverage, wave_height null, no fetch.
 * The kill switch (__RAW_DISABLE_ONE_INSTANT_RANGE__) prints the run's own reading; GFS (no such gate) is the control.
 */
import { selectExactPointHour } from './forecastSamplers';
import { compileForecastCards } from './forecastCardCompiler';
import { getBackendIconMarineFlag } from './backendWeatherServiceClient';

const H = 3600000;
const RUN_START = Date.parse('2026-10-28T10:07:15Z');
// (wheel hour, the stored frame the point answered with), as the run recorded them.
const ROWS = [[0, '09:00'], [1, '12:00'], [2, '12:00'], [3, '12:00'], [4, '15:00'], [5, '15:00'], [6, '15:00'], [7, '18:00']];
const answer = (hhmm, model) => ({
  hourly: { time: [`2026-10-28T${hhmm}:00Z`], wave_height: [0.915], wave_direction: [265], wave_period: [7.5] },
  requestedLat: 30, requestedLng: -70, requestedModel: model, activeLayer: 'waves', provider: 'backend-weather-service',
  source: 'network', status: 'exact_success', is_estimated: false,
});
const swellCard = (p) => compileForecastCards({
  activeLayer: 'waves', activeModel: p.requestedModel, isLoading: false, isExactPointAuthority: true, exactPointStatus: p.status,
  useExactPoint: p.status === 'exact_success' ? p : null, waveHeight: p.wave_height ?? null, wavePeriod: p.wave_period ?? null,
  waveDir: p.wave_direction ?? null, degToCompass: () => 'W', heightUnit: 'ft',
}).find((c) => c.label === 'Swell');
const read = (model) => ROWS.map(([hour, hhmm]) => {
  const p = selectExactPointHour(answer(hhmm, model), hour);
  return [hour, p.status, swellCard(p).ariaLabel];
});

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(RUN_START);
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  window.__USE_BACKEND_ICON_MARINE_SERVICE__ = true;
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__USE_BACKEND_MARINE_SYSTEM__;
  delete window.__USE_BACKEND_ICON_MARINE_SERVICE__;
  delete window.__RAW_DISABLE_ONE_INSTANT_RANGE__;
});

test('the gate is live in this replay (the ICON backend lane is on, as in the run)', () => {
  expect(getBackendIconMarineFlag()).toBe(true);
});

test('BEFORE (kill switch): hours 3 and 6 blank exactly as the run recorded; every other hour reads', () => {
  window.__RAW_DISABLE_ONE_INSTANT_RANGE__ = true;
  const rows = read('ICON');
  expect(rows.filter(([, s]) => s === 'no_coverage').map(([h]) => h)).toEqual([3, 6]);
  expect(rows.find(([h]) => h === 3)[2]).toBe('Offshore swell height --');
  expect(rows.find(([h]) => h === 6)[2]).toBe('Offshore swell height --');
  expect(rows.find(([h]) => h === 2)[2]).toBe('Offshore swell height 3.0 ft');
});

test('AFTER: all eight ICON hours read the answer they hold, like GFS', () => {
  const rows = read('ICON');
  expect(rows.map(([, s]) => s)).toEqual(Array(8).fill('exact_success'));
  expect(rows.map(([, , a]) => a)).toEqual(Array(8).fill('Offshore swell height 3.0 ft'));
});

test('control: GFS reads every hour before and after (it never had the gate)', () => {
  const after = read('GFS');
  window.__RAW_DISABLE_ONE_INSTANT_RANGE__ = true;
  expect(read('GFS')).toEqual(after);
  expect(after.map(([, s]) => s)).toEqual(Array(8).fill('exact_success'));
});

test('control: a MULTI-hour response still ends where its last time says (the range rule is unchanged)', () => {
  // A 6-hour series ending at 15Z: hour 8 (18Z) is past it and stays no_coverage; hour 4 reads.
  const times = [10, 11, 12, 13, 14, 15].map((hh) => `2026-10-28T${hh}:00:00Z`);
  const series = { ...answer('10:00', 'ICON'), hourly: { time: times, wave_height: times.map(() => 0.915),
    wave_direction: times.map(() => 265), wave_period: times.map(() => 7.5) } };
  expect(selectExactPointHour(series, 8).status).toBe('no_coverage');
  expect(selectExactPointHour(series, 4).status).toBe('exact_success');
  expect(RUN_START + 8 * H).toBeGreaterThan(Date.parse(times[times.length - 1]));
});

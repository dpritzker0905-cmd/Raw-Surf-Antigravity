import { activeCadenceHours, stepHour, stepLabel, stepAria } from './cadenceStep';

const setCaps = (caps) => { window.__WEATHER_CAPABILITIES__ = caps; };
afterEach(() => { delete window.__WEATHER_CAPABILITIES__; delete window.__RAW_DISABLE_CADENCE_STEP__; });

describe('cadenceStep', () => {
  test('cadence comes from /capabilities rows; hourly or unknown is 1', () => {
    setCaps([
      { model: 'GFS', layer: 'swell_2', cadence_hours: 3 },
      { model: 'ICON', layer: 'swell_1', cadence_hours: 1 },
    ]);
    expect(activeCadenceHours('GFS', 'swell_2')).toBe(3);
    expect(activeCadenceHours('ICON', 'swell_1')).toBe(1);
    expect(activeCadenceHours('GFS', 'nope')).toBe(1);
  });

  test('no capabilities loaded and the kill switch both give 1', () => {
    expect(activeCadenceHours('GFS', 'swell_2')).toBe(1);
    setCaps([{ model: 'GFS', layer: 'swell_2', cadence_hours: 3 }]);
    window.__RAW_DISABLE_CADENCE_STEP__ = true;
    expect(activeCadenceHours('GFS', 'swell_2')).toBe(1);
  });

  test('hourly step is +-1, clamped', () => {
    expect(stepHour(5, 1, 1, 336)).toBe(6);
    expect(stepHour(0, -1, 1, 336)).toBe(0);
    expect(stepHour(336, 1, 1, 336)).toBe(336);
  });

  test('3-hourly step lands on consecutive grid hours, always moving', () => {
    let h = 0; const seen = [];
    for (let i = 0; i < 4; i++) { h = stepHour(h, 1, 3, 336); seen.push(h); }
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBe(3);
    expect(stepHour(h, -1, 3, 336)).toBe(seen[2]);
    expect(stepHour(seen[0], -1, 3, 336)).toBeLessThan(seen[0]);
  });

  test('labels and aria', () => {
    expect(stepLabel(1, 3)).toBe('+3h');
    expect(stepLabel(-1, 1)).toBe('−1h');
    expect(stepAria(1, 3)).toBe('Step forward 3 hours');
    expect(stepAria(-1, 1)).toBe('Step back 1 hour');
  });
});

import { tideAt, tideCurve, tideCovers, formatTideTime } from './tideReadoutFormat';

const time = (h) => new Date(Date.UTC(2026, 10, 7) + h * 3600000).toISOString();
const data = { series: Array.from({ length: 72 }, (_, h) => ({ t: time(h), h: Math.sin(h) })), events: [] };

test('selection follows the returned coverage and bounds its curve', () => {
  const selected = tideAt(data, Date.parse(time(48)));
  expect(selected.height_m).toBeCloseTo(Math.sin(48), 3);
  expect(selected.series).toHaveLength(25);
  expect(selected.series[0].t).toBe(time(42));
  expect(selected.tz_offset_h).toBe('UTC');
  expect(tideAt(data, Date.parse(time(80)))).toBeNull();
  expect(tideAt(data, NaN)).toBeNull();
});

test.each([null, NaN, Infinity, true, '0.5'])('never substitutes invalid height %s', (bad) => {
  const d = { series: [{ t: time(0), h: 0 }, { t: time(1), h: bad }, { t: time(2), h: 1 }] };
  expect(tideAt(d, Date.parse(time(1)))).toBeNull();
  expect(tideCurve(d.series, time(1))?.nowX).toBeNull();
});

test('gaps and repeated timestamps cannot create a selected reading', () => {
  const d = { series: [{ t: time(0), h: 0 }, { t: time(2), h: 1 }, { t: time(3), h: 0 }] };
  expect(tideAt(d, Date.parse(time(1)))).toBeNull();
  expect(tideCurve(d.series, time(1)).path.match(/M/g)).toHaveLength(2);
  expect(tideAt({ series: [d.series[0], d.series[0]] }, Date.parse(time(0)))).toBeNull();
  const declared = { series: [0, 1, 2, 3].map(h => ({ t: time(h), h })),
    coverage: [{ start: time(0), end: time(1) }, { start: time(2), end: time(3) }], events: [] };
  expect(tideAt(declared, Date.parse(time(1.5)))).toBeNull();
  for (const h of [0, 0.5, 1, 2, 2.5, 3]) {
    expect(tideAt(declared, Date.parse(time(h))).height_m).toBe(h);
  }
  const curve = tideCurve(declared, time(0.5));
  expect(curve.path.match(/M/g)).toHaveLength(2);
  expect(curve.path.match(/[ML]/g)).toHaveLength(4);
  expect(tideCurve(declared, time(1.5)).nowX).toBeNull();
  const island = { ...declared, series: [{ t: time(-1), h: 9 }, ...declared.series] };
  expect(tideAt(island, Date.parse(time(-1)))).toBeNull();
  expect(tideCurve(island, time(0.5)).path.match(/[ML]/g)).toHaveLength(4);
  for (const coverage of [[], null, {}, [{ start: 'bad', end: time(3) }],
    [{ start: time(3), end: time(0) }], [{ start: time(1), end: time(1) }],
    [{ start: time(0), end: time(2) }, { start: time(1), end: time(3) }],
    [{ start: time(2), end: time(3) }, { start: time(0), end: time(1) }]]) {
    expect(tideAt({ ...declared, coverage }, Date.parse(time(0.5)))).toBeNull();
    expect(tideCurve({ ...declared, coverage }, time(0.5))).toBeNull();
  }
});

test('UTC display is explicit and invariant across browser offsets', () => {
  expect(formatTideTime(time(14), 'UTC', -5)).toMatch(/2:00/);
  expect(formatTideTime(time(14), 'UTC', 10)).toBe(formatTideTime(time(14), 'UTC', -5));
});


test('next events stop at a gap, and the valid edge is still available', () => {
  const d = { series: [{ t: time(0), h: 0 }, { t: time(1), h: 1 }, { t: time(2), h: null },
    { t: time(3), h: 0 }, { t: time(4), h: 1 }],
  events: [{ time: time(4), type: 'High', height_m: 1 }] };
  expect(tideAt(d, Date.parse(time(0))).next_high).toBeNull();
  expect(tideAt(d, Date.parse(time(1))).height_m).toBe(1);
  const declared = { series: Array.from({ length: 11 }, (_, h) => ({ t: time(h), h })),
    coverage: [{ start: time(0), end: time(1) }, { start: time(2), end: time(10) }],
    events: [{ time: time(3), type: 'High', height_m: 3 }] };
  expect(tideAt(declared, Date.parse(time(0.5))).next_high).toBeNull();
  expect(tideAt(declared, Date.parse(time(1))).height_m).toBe(1);
  expect(tideAt(declared, Date.parse(time(2))).next_high.time).toBe(time(3));
  expect(tideCovers(declared, Date.parse(time(0)))).toBe(false);
  expect(tideCovers(declared, Date.parse(time(2)))).toBe(true);
});

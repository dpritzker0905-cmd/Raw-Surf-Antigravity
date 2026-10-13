import { marineFrameInstant, sameMarineFrameInstant } from './marineFrameInstant';

it.each([null, undefined, '', 0, 'not-a-time', '2026-10-07', '2026-10-07T15:00:00',
  '2026-02-30T15:00:00Z', '2026-13-01T00:00:00Z', '2026-10-07T24:00:00Z',
  '2026-10-07T15:60:00Z', '2026-10-07T15:00:60Z'])('unknown actual clock %s stays unknown', time => {
  expect(marineFrameInstant({ served_valid_time: time, valid_time: '2026-10-07T15:00:00Z',
    frameReceipt: { servedValidTime: '2026-10-07T15:00:00Z' } })).toBeNull();
});
it('UTC epoch zero is known and comparable', () => {
  const g = { served_valid_time: '1970-01-01T00:00:00Z' };
  expect(marineFrameInstant(g)).toBe(0);
  expect(sameMarineFrameInstant(g, g)).toBe(true);
});
it('equal zoned instants compare independent of label, requested echo and diagnostics', () => {
  expect(sameMarineFrameInstant({ served_valid_time: '2026-10-07T15:00:00.000Z', hourOffset: 144 },
    { served_valid_time: '2026-10-07T11:00:00-04:00', hourOffset: 145, valid_time: '2026-10-07T18:00:00Z' })).toBe(true);
});
it('leap day is valid only in a leap year', () => {
  expect(marineFrameInstant({ served_valid_time: '2024-02-29T00:00:00Z' })).not.toBeNull();
  expect(marineFrameInstant({ served_valid_time: '2026-02-29T00:00:00Z' })).toBeNull();
});
it('missing grids and missing actual clocks do not certify matching frames', () => {
  expect(sameMarineFrameInstant(null, null)).toBe(false);
  expect(sameMarineFrameInstant({}, {})).toBe(false);
});

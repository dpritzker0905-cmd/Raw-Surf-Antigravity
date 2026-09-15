import { describeResidentMarineGrid } from './marineResidentEvidence';

test('missing provenance stays missing rather than borrowing a requested time', () => {
  expect(describeResidentMarineGrid(null)).toBeNull();
  const result = describeResidentMarineGrid({ valid_time: '2026-09-15T00:00:00Z', vectors: [] });
  expect(result.servedValidTime).toBeNull();
  expect(result.modelRunTime).toBeNull();
  expect(result.samples).toEqual([]);
});

test('time-only edits leave physical samples unchanged; real field edits do not', () => {
  const grid = { valid_time: 'now', vectors: [{ lat: 10, lng: -90, speed: 2, u: 1, v: 1, period: 8, is_valid: true }] };
  const before = describeResidentMarineGrid(grid);
  const metadataOnly = describeResidentMarineGrid({ ...grid, valid_time: 'tomorrow' });
  expect(metadataOnly.requestedValidTime).not.toBe(before.requestedValidTime);
  expect(metadataOnly.samples).toEqual(before.samples);
  const changed = describeResidentMarineGrid({ ...grid, vectors: [{ ...grid.vectors[0], speed: 3 }] });
  expect(changed.samples).not.toEqual(before.samples);
});

test('reads at most nine nodes even for a large resident grid', () => {
  let reads = 0;
  const vectors = new Proxy(new Array(100000), { get(target, key) {
    if (/^\d+$/.test(String(key))) { reads += 1; return { speed: 2 }; }
    return target[key];
  } });
  const result = describeResidentMarineGrid({ vectors });
  expect(reads).toBe(9);
  expect(result.samples).toHaveLength(9);
  expect(result.samples[0].index).toBe(0);
  expect(result.samples[8].index).toBe(99999);
});

test('does not mutate the renderer grid and sanitizes nonfinite samples', () => {
  const vector = Object.freeze({ lat: NaN, lng: Infinity, speed: 0, u: null, v: 0, period: 5, is_valid: false });
  const grid = Object.freeze({ vectors: Object.freeze([vector]), served_valid_time: 'served', model_run_time: 'cycle' });
  const result = describeResidentMarineGrid(grid);
  expect(result.samples[0]).toEqual({ index: 0, lat: null, lng: null, speed: 0, u: null, v: 0, period: 5, valid: false });
  expect(result.servedValidTime).toBe('served');
  expect(result.modelRunTime).toBe('cycle');
});


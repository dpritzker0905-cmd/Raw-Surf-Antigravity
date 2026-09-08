import { buildTruthTag } from './weatherTruthTracker';

const payload = () => ({
  model: 'GFS', domain: 'marine', layer: 'waves',
  valid_time: '2026-09-07T12:30:00Z',
  grid: { vectors: [{ lat: 0, lng: 0, speed: 2 }], cols: 1, rows: 1 },
});

test('verified lead follows cycle, independent of receipt time and browser clock', () => {
  const tags = [];
  for (const receipt of ['2026-09-07T13:00:00Z', '2026-09-07T19:00:00Z']) {
    for (const cycle of ['2026-09-07T00:00:00Z', '2026-09-07T06:00:00Z']) {
      const tag = buildTruthTag({ ...payload(), run_time: receipt, ingested_at: receipt,
        model_run_time: cycle, model_run_time_status: 'known' }, 'test');
      expect(tag.forecastLeadHours).toBe(cycle.includes('T00') ? 12.5 : 6.5);
      expect(tag.model_run_time).toBe(cycle);
      expect(tag.ingested_at).toBe(receipt);
      tags.push(tag);
    }
  }
  expect(new Set(tags.map(t => t.dataHash)).size).toBe(1);
});

test.each(['missing', 'incomplete', 'conflicting', 'invalid'])('%s evidence never yields a verified lead', status => {
  const tag = buildTruthTag({ ...payload(), model_run_time_status: status,
    model_run_time: '2026-09-07T00:00:00Z', run_time: '2026-09-07T00:00:00Z' }, 'test');
  expect(tag.forecastLeadHours).toBeNull();
  expect(tag.model_run_time).toBeNull();
});

test.each([undefined, 'garbage', '2026-09-07T00:00:00'])('absent or invalid cycle is not inferred: %s', cycle => {
  const tag = buildTruthTag({ ...payload(), model_run_time: cycle,
    model_run_time_status: 'known' }, 'test');
  expect(tag.forecastLeadHours).toBeNull();
});
